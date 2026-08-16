'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionState, MediaDeviceFailure, RoomEvent } from 'livekit-client';
import type { RemoteParticipant } from 'livekit-client';
import {
  BarVisualizer,
  RoomAudioRenderer,
  StartAudio,
  useLocalParticipant,
  useSessionContext,
  useVoiceAssistant,
} from '@livekit/components-react';
import type { AgentState } from '@livekit/components-react';
import type { AppConfig } from '@/lib/types';

const STATUS_LABELS: Record<AgentState, string> = {
  disconnected: 'Ready to talk',
  connecting: 'Connecting to Ava...',
  'pre-connect-buffering': 'Connecting to Ava...',
  initializing: 'Connecting to Ava...',
  idle: 'Ava is ready',
  listening: 'Listening...',
  thinking: 'Ava is thinking...',
  speaking: 'Ava is speaking...',
  failed: 'Unable to connect. Please try again.',
};

const AGENT_READY_TIMEOUT_MILLISECONDS = 30_000;
const ACTIVE_AGENT_STATES = new Set<AgentState>(['listening', 'thinking', 'speaking']);

type SessionEndReason =
  | 'USER_ENDED'
  | 'CONNECT_FAILED'
  | 'AGENT_READY_TIMEOUT'
  | 'AGENT_CONNECTION_FAILED'
  | 'UNEXPECTED_DISCONNECT';

type SessionViewProps = {
  appConfig: AppConfig;
};

function friendlyConnectionError(error: unknown): string {
  const failure = MediaDeviceFailure.getFailure(error);
  if (failure === MediaDeviceFailure.PermissionDenied) {
    return 'Microphone access is required to talk with Ava.';
  }
  if (failure === MediaDeviceFailure.NotFound) {
    return 'No microphone was found. Connect a microphone and try again.';
  }
  if (failure === MediaDeviceFailure.DeviceInUse) {
    return 'Your microphone is being used by another application.';
  }
  return "We couldn't connect to Ava. Please try again.";
}

function connectionErrorCategory(error: unknown): string {
  const failure = MediaDeviceFailure.getFailure(error);
  if (failure === MediaDeviceFailure.PermissionDenied) return 'MIC_PERMISSION_DENIED';
  if (failure === MediaDeviceFailure.NotFound) return 'MIC_NOT_FOUND';
  if (failure === MediaDeviceFailure.DeviceInUse) return 'MIC_DEVICE_IN_USE';
  if (error instanceof Error && error.message.includes('Error generating token from endpoint')) {
    return 'TOKEN_REQUEST_HTTP_ERROR';
  }
  return 'SESSION_CONNECT_FAILED';
}

export function SessionView({ appConfig }: SessionViewProps) {
  const session = useSessionContext();
  const voiceAssistant = useVoiceAssistant();
  const { isMicrophoneEnabled } = useLocalParticipant({ room: session.room });
  const [sessionStarted, setSessionStarted] = useState(false);
  const [pendingAction, setPendingAction] = useState<'start' | 'mute' | 'end' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const connectedOnce = useRef(false);
  const endingIntentionally = useRef(false);
  const startInProgress = useRef(false);
  const startAbortController = useRef<AbortController | null>(null);
  const sessionStartedAt = useRef<number | null>(null);
  const tokenReceivedLogged = useRef(false);
  const roomConnectedLogged = useRef(false);
  const agentWaitingLogged = useRef(false);
  const agentFailureHandled = useRef(false);
  const hasAgentEverBeenReadyRef = useRef(false);
  const readinessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionGenerationRef = useRef(0);
  const nextSessionGenerationRef = useRef(0);
  const previousAgentStateRef = useRef<AgentState>('disconnected');

  const elapsedMilliseconds = useCallback(() => {
    if (sessionStartedAt.current === null) return 0;
    return Math.round(performance.now() - sessionStartedAt.current);
  }, []);

  const clearReadinessTimer = useCallback(() => {
    if (readinessTimerRef.current === null) return;
    clearTimeout(readinessTimerRef.current);
    readinessTimerRef.current = null;
    console.info('READINESS_TIMER_CLEARED');
  }, []);

  const resetSession = useCallback(
    async (reason: SessionEndReason) => {
      endingIntentionally.current = true;
      sessionGenerationRef.current = 0;
      clearReadinessTimer();
      startAbortController.current?.abort();
      startAbortController.current = null;
      hasAgentEverBeenReadyRef.current = false;
      setSessionStarted(false);

      const shouldLogDisconnect = connectedOnce.current && reason !== 'UNEXPECTED_DISCONNECT';

      try {
        await session.end();
      } catch (error) {
        console.error(`SESSION_END_FAILED | category=${connectionErrorCategory(error)}`);
      } finally {
        if (shouldLogDisconnect) {
          console.info(
            `SESSION_DISCONNECTED | reason=${reason} | elapsed_ms=${elapsedMilliseconds()}`
          );
        }
        setPendingAction(null);
        connectedOnce.current = false;
        endingIntentionally.current = false;
        console.info(`SESSION_ENDED | reason=${reason}`);
      }
    },
    [clearReadinessTimer, elapsedMilliseconds, session]
  );

  const startConversation = useCallback(async () => {
    if (startInProgress.current) return;
    startInProgress.current = true;
    clearReadinessTimer();
    const generation = nextSessionGenerationRef.current + 1;
    nextSessionGenerationRef.current = generation;
    sessionGenerationRef.current = generation;
    const abortController = new AbortController();
    startAbortController.current = abortController;
    sessionStartedAt.current = performance.now();
    tokenReceivedLogged.current = false;
    roomConnectedLogged.current = false;
    agentWaitingLogged.current = false;
    agentFailureHandled.current = false;
    hasAgentEverBeenReadyRef.current = false;
    previousAgentStateRef.current = 'disconnected';
    setErrorMessage(null);
    setSessionStarted(true);
    setPendingAction('start');
    endingIntentionally.current = false;
    console.info(`START_SESSION | generation=${generation}`);

    readinessTimerRef.current = setTimeout(() => {
      if (generation !== sessionGenerationRef.current || hasAgentEverBeenReadyRef.current) {
        return;
      }

      readinessTimerRef.current = null;
      console.error(`STARTUP_TIMEOUT_FIRED | generation=${generation}`);
      setErrorMessage('Ava is taking longer than expected to start. Please try again.');
      void resetSession('AGENT_READY_TIMEOUT');
    }, AGENT_READY_TIMEOUT_MILLISECONDS);

    try {
      await session.room.startAudio();
      await session.start({
        signal: abortController.signal,
        tracks: {
          microphone: {
            enabled: true,
            publishOptions: { preConnectBuffer: appConfig.isPreConnectBufferEnabled },
          },
          camera: { enabled: false },
          screenShare: { enabled: false },
        },
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      const category = connectionErrorCategory(error);
      console.error(
        `SESSION_CONNECT_FAILED | category=${category} | elapsed_ms=${elapsedMilliseconds()}`
      );
      setErrorMessage(friendlyConnectionError(error));
      await resetSession('CONNECT_FAILED');
    } finally {
      if (startAbortController.current === abortController) {
        startAbortController.current = null;
      }
      startInProgress.current = false;
      setPendingAction(null);
    }
  }, [
    appConfig.isPreConnectBufferEnabled,
    clearReadinessTimer,
    elapsedMilliseconds,
    resetSession,
    session,
  ]);

  const toggleMicrophone = useCallback(async () => {
    setPendingAction('mute');
    try {
      await session.room.localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (error) {
      console.error(`MICROPHONE_UPDATE_FAILED | category=${connectionErrorCategory(error)}`);
      setErrorMessage('Unable to change the microphone. Please try again.');
    } finally {
      setPendingAction(null);
    }
  }, [isMicrophoneEnabled, session.room]);

  const endConversation = useCallback(async () => {
    setPendingAction('end');
    setErrorMessage(null);
    await resetSession('USER_ENDED');
  }, [resetSession]);

  useEffect(() => {
    if (
      sessionStarted &&
      session.connectionState === ConnectionState.Connecting &&
      !tokenReceivedLogged.current
    ) {
      tokenReceivedLogged.current = true;
      console.info(`TOKEN_RECEIVED | elapsed_ms=${elapsedMilliseconds()}`);
    }

    if (session.connectionState === ConnectionState.Connected) {
      connectedOnce.current = true;

      if (!tokenReceivedLogged.current) {
        tokenReceivedLogged.current = true;
        console.info(`TOKEN_RECEIVED | elapsed_ms=${elapsedMilliseconds()}`);
      }

      if (!roomConnectedLogged.current) {
        roomConnectedLogged.current = true;
        console.info(`ROOM_CONNECTED | elapsed_ms=${elapsedMilliseconds()}`);
      }

      if (!hasAgentEverBeenReadyRef.current && !agentWaitingLogged.current) {
        agentWaitingLogged.current = true;
        console.info(`AGENT_WAITING | agent=livekit-agent | elapsed_ms=${elapsedMilliseconds()}`);
      }
    }

    if (
      sessionStarted &&
      connectedOnce.current &&
      session.connectionState === ConnectionState.Disconnected &&
      !endingIntentionally.current
    ) {
      console.info(
        `SESSION_DISCONNECTED | reason=UNEXPECTED_DISCONNECT | elapsed_ms=${elapsedMilliseconds()}`
      );
      console.error(
        `SESSION_CONNECT_FAILED | category=UNEXPECTED_DISCONNECT | elapsed_ms=${elapsedMilliseconds()}`
      );
      setErrorMessage('The connection to Ava ended unexpectedly. Please try again.');
      void resetSession('UNEXPECTED_DISCONNECT');
    }
  }, [elapsedMilliseconds, resetSession, session.connectionState, sessionStarted]);

  useEffect(() => {
    const previousState = previousAgentStateRef.current;
    if (sessionStarted && previousState !== voiceAssistant.state) {
      console.info(`AGENT_STATE_CHANGED | old=${previousState} | new=${voiceAssistant.state}`);
      previousAgentStateRef.current = voiceAssistant.state;
    }

    const readinessProven =
      ACTIVE_AGENT_STATES.has(voiceAssistant.state) || voiceAssistant.audioTrack !== undefined;

    if (sessionStarted && readinessProven && !hasAgentEverBeenReadyRef.current) {
      hasAgentEverBeenReadyRef.current = true;
      clearReadinessTimer();
      session.internal.clearAgentTimeout();
      console.info(
        `AGENT_FIRST_READY | state=${voiceAssistant.state} | elapsed_ms=${elapsedMilliseconds()}`
      );
    }

    if (sessionStarted && voiceAssistant.state === 'failed' && !agentFailureHandled.current) {
      agentFailureHandled.current = true;
      const wasReady = hasAgentEverBeenReadyRef.current;
      console.error(`SESSION_FAILED | reason-category=AGENT_REPORTED_FAILED`);
      setErrorMessage(
        wasReady
          ? 'The connection to Ava was lost. Please try again.'
          : "We couldn't connect to Ava. Please try again."
      );
      void resetSession('AGENT_CONNECTION_FAILED');
    }
  }, [
    clearReadinessTimer,
    elapsedMilliseconds,
    resetSession,
    session,
    sessionStarted,
    voiceAssistant.audioTrack,
    voiceAssistant.state,
  ]);

  useEffect(() => {
    const agentIdentity = voiceAssistant.agent?.identity;
    if (!agentIdentity) return;

    const handleParticipantDisconnected = (participant: RemoteParticipant) => {
      if (
        participant.identity !== agentIdentity ||
        !sessionStarted ||
        !hasAgentEverBeenReadyRef.current ||
        endingIntentionally.current ||
        agentFailureHandled.current
      ) {
        return;
      }

      agentFailureHandled.current = true;
      console.error('SESSION_FAILED | reason-category=AGENT_DISCONNECTED');
      setErrorMessage('The connection to Ava was lost. Please try again.');
      void resetSession('AGENT_CONNECTION_FAILED');
    };

    session.room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    return () => {
      session.room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    };
  }, [resetSession, session.room, sessionStarted, voiceAssistant.agent?.identity]);

  useEffect(() => {
    return () => {
      clearReadinessTimer();
      startAbortController.current?.abort();
    };
  }, [clearReadinessTimer]);

  const activeState: AgentState = sessionStarted
    ? voiceAssistant.state === 'disconnected'
      ? 'connecting'
      : voiceAssistant.state
    : 'disconnected';
  const roomIsConnected = session.connectionState === ConnectionState.Connected;
  const statusLabel =
    errorMessage ??
    (sessionStarted && roomIsConnected && !hasAgentEverBeenReadyRef.current
      ? 'Starting Ava...'
      : STATUS_LABELS[activeState]);
  const isConnecting =
    sessionStarted && (pendingAction === 'start' || !hasAgentEverBeenReadyRef.current);

  return (
    <main className="ava-assistant" aria-label="Ava voice assistant">
      <RoomAudioRenderer room={session.room} />
      <StartAudio room={session.room} label="Enable Ava audio" className="ava-audio-unlock" />

      <div className={`ava-avatar ${sessionStarted ? 'is-active' : ''}`} aria-hidden="true">
        A
      </div>
      <h1>Ava</h1>
      <p className="ava-role">Best Driving School AI Receptionist</p>

      <div className="ava-visualizer" aria-hidden="true">
        <BarVisualizer
          barCount={7}
          state={activeState}
          trackRef={voiceAssistant.audioTrack}
          options={{ minHeight: 8 }}
          className="ava-visualizer-bars"
        >
          <span className="ava-visualizer-bar" />
        </BarVisualizer>
      </div>

      <p
        className={`ava-status ${errorMessage ? 'is-error' : ''}`}
        role={errorMessage ? 'alert' : 'status'}
        aria-live="polite"
      >
        {statusLabel}
      </p>

      {sessionStarted ? (
        <div className="ava-controls" aria-label="Conversation controls">
          <button
            type="button"
            className="ava-button ava-button-secondary"
            onClick={toggleMicrophone}
            disabled={isConnecting || pendingAction !== null}
            aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
            aria-pressed={!isMicrophoneEnabled}
          >
            {pendingAction === 'mute' ? 'Updating...' : isMicrophoneEnabled ? 'Mute' : 'Unmute'}
          </button>
          <button
            type="button"
            className="ava-button ava-button-end"
            onClick={endConversation}
            disabled={pendingAction !== null}
            aria-label="End conversation with Ava"
          >
            {pendingAction === 'end' ? 'Ending...' : 'End Conversation'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="ava-button ava-button-primary"
          onClick={startConversation}
          disabled={pendingAction !== null}
          aria-label="Start a voice conversation with Ava"
        >
          {errorMessage ? 'Retry' : 'Start Conversation'}
        </button>
      )}

      <p className="ava-helper">
        {sessionStarted
          ? isMicrophoneEnabled
            ? 'Your microphone is on'
            : 'Your microphone is muted'
          : errorMessage
            ? 'Check your microphone and try again'
            : 'Ready to help'}
      </p>
    </main>
  );
}
