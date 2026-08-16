'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionState, MediaDeviceFailure } from 'livekit-client';
import {
  BarVisualizer,
  RoomAudioRenderer,
  StartAudio,
  useAgent,
  useLocalParticipant,
  useSessionContext,
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
  const agent = useAgent(session);
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
  const agentConnectedLogged = useRef(false);
  const agentReadyHandled = useRef(false);
  const agentFailureHandled = useRef(false);

  const elapsedMilliseconds = useCallback(() => {
    if (sessionStartedAt.current === null) return 0;
    return Math.round(performance.now() - sessionStartedAt.current);
  }, []);

  const resetSession = useCallback(
    async (reason: SessionEndReason) => {
      endingIntentionally.current = true;
      startAbortController.current?.abort();
      startAbortController.current = null;
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
      }
    },
    [elapsedMilliseconds, session]
  );

  const startConversation = useCallback(async () => {
    if (startInProgress.current) return;
    startInProgress.current = true;
    const abortController = new AbortController();
    startAbortController.current = abortController;
    sessionStartedAt.current = performance.now();
    tokenReceivedLogged.current = false;
    roomConnectedLogged.current = false;
    agentWaitingLogged.current = false;
    agentConnectedLogged.current = false;
    agentReadyHandled.current = false;
    agentFailureHandled.current = false;
    setErrorMessage(null);
    setSessionStarted(true);
    setPendingAction('start');
    endingIntentionally.current = false;
    console.info('SESSION_STARTING | elapsed_ms=0');

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
  }, [appConfig.isPreConnectBufferEnabled, elapsedMilliseconds, resetSession, session]);

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

      if (!agent.isConnected && !agentWaitingLogged.current) {
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
  }, [
    agent.isConnected,
    elapsedMilliseconds,
    resetSession,
    session.connectionState,
    sessionStarted,
  ]);

  useEffect(() => {
    const agentParticipantJoined = agent.internal.agentParticipant !== null;

    if (sessionStarted && agentParticipantJoined && !agentConnectedLogged.current) {
      agentConnectedLogged.current = true;
      console.info(
        `AGENT_CONNECTED | agent=livekit-agent | state=${agent.state} | elapsed_ms=${elapsedMilliseconds()}`
      );
    }

    if (sessionStarted && agent.isConnected && !agentReadyHandled.current) {
      agentReadyHandled.current = true;
      session.internal.clearAgentTimeout();
    }

    if (sessionStarted && agent.state === 'failed' && !agentFailureHandled.current) {
      agentFailureHandled.current = true;
      const readinessTimedOut = agent.failureReasons.some(
        (reason) =>
          reason.includes('did not join') || reason.includes('did not complete initializing')
      );

      if (readinessTimedOut) {
        console.error(`AGENT_READY_TIMEOUT | elapsed_ms=${elapsedMilliseconds()}`);
        setErrorMessage('Ava is taking longer than expected to start. Please try again.');
        void resetSession('AGENT_READY_TIMEOUT');
        return;
      }

      console.error(
        `SESSION_CONNECT_FAILED | category=AGENT_CONNECTION_FAILED | elapsed_ms=${elapsedMilliseconds()}`
      );
      setErrorMessage('The connection to Ava ended unexpectedly. Please try again.');
      void resetSession('AGENT_CONNECTION_FAILED');
    }
  }, [agent, elapsedMilliseconds, resetSession, session, sessionStarted]);

  useEffect(() => {
    return () => {
      startAbortController.current?.abort();
    };
  }, []);

  const activeState: AgentState = sessionStarted
    ? agent.state === 'disconnected'
      ? 'connecting'
      : agent.state
    : 'disconnected';
  const roomIsConnected = session.connectionState === ConnectionState.Connected;
  const statusLabel =
    errorMessage ??
    (sessionStarted && roomIsConnected && !agent.isConnected
      ? 'Starting Ava...'
      : STATUS_LABELS[activeState]);
  const isConnecting =
    sessionStarted &&
    (pendingAction === 'start' ||
      !agent.isConnected ||
      ['connecting', 'pre-connect-buffering', 'initializing'].includes(activeState));

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
          trackRef={agent.microphoneTrack}
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
