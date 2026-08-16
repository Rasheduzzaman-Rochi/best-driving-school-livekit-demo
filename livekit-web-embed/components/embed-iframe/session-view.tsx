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

  const resetSession = useCallback(async () => {
    endingIntentionally.current = true;
    try {
      await session.end();
    } catch (error) {
      console.error(`SESSION_END_FAILED | category=${connectionErrorCategory(error)}`);
    } finally {
      setSessionStarted(false);
      setPendingAction(null);
      connectedOnce.current = false;
      endingIntentionally.current = false;
    }
  }, [session]);

  const startConversation = useCallback(async () => {
    if (startInProgress.current) return;
    startInProgress.current = true;
    setErrorMessage(null);
    setSessionStarted(true);
    setPendingAction('start');
    endingIntentionally.current = false;
    console.info('SESSION_STARTING');
    console.info('AGENT_WAITING | agent=livekit-agent');

    try {
      await session.room.startAudio();
      await session.start({
        tracks: {
          microphone: {
            enabled: true,
            publishOptions: { preConnectBuffer: appConfig.isPreConnectBufferEnabled },
          },
          camera: { enabled: false },
          screenShare: { enabled: false },
        },
      });
      connectedOnce.current = true;
      console.info('SESSION_CONNECTED');
      console.info('AGENT_CONNECTED | agent=livekit-agent');
    } catch (error) {
      const category = connectionErrorCategory(error);
      console.error(`SESSION_CONNECT_FAILED | category=${category}`);
      setErrorMessage(friendlyConnectionError(error));
      await resetSession();
    } finally {
      startInProgress.current = false;
      setPendingAction(null);
    }
  }, [appConfig.isPreConnectBufferEnabled, resetSession, session]);

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
    await resetSession();
  }, [resetSession]);

  useEffect(() => {
    if (session.connectionState === ConnectionState.Connected) {
      connectedOnce.current = true;
    }

    if (
      sessionStarted &&
      connectedOnce.current &&
      session.connectionState === ConnectionState.Disconnected &&
      !endingIntentionally.current
    ) {
      console.error('SESSION_CONNECT_FAILED | category=UNEXPECTED_DISCONNECT');
      setErrorMessage('The connection to Ava ended unexpectedly. Please try again.');
      setSessionStarted(false);
      connectedOnce.current = false;
    }
  }, [session.connectionState, sessionStarted]);

  useEffect(() => {
    if (sessionStarted && agent.state === 'failed') {
      console.error('SESSION_CONNECT_FAILED | category=AGENT_CONNECTION_FAILED');
      setErrorMessage("We couldn't connect to Ava. Please try again.");
      void resetSession();
    }
  }, [agent.state, resetSession, sessionStarted]);

  const activeState: AgentState = sessionStarted
    ? agent.state === 'disconnected'
      ? 'connecting'
      : agent.state
    : 'disconnected';
  const statusLabel = errorMessage ?? STATUS_LABELS[activeState];
  const isConnecting =
    sessionStarted &&
    (pendingAction === 'start' ||
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
          Start Conversation
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
