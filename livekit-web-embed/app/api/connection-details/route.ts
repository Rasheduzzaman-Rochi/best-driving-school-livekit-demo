import { NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import { RoomAgentDispatch, RoomConfiguration, TrackSource } from '@livekit/protocol';

const AGENT_NAME = 'livekit-agent';
const MAX_REQUEST_BYTES = 4_096;
const ALLOWED_REQUEST_KEYS = new Set([
  'room_name',
  'participant_identity',
  'participant_name',
  'participant_metadata',
  'participant_attributes',
  'room_config',
]);

// don't cache the results
export const revalidate = 0;

type JsonObject = Record<string, unknown>;
type ServerConfig = {
  apiKey: string;
  apiSecret: string;
  livekitUrl: string;
};

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

function hasValidParticipantAttributes(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isJsonObject(value) || Object.keys(value).length > 20) return false;
  return Object.entries(value).every(
    ([key, attribute]) =>
      key.length <= 128 && typeof attribute === 'string' && attribute.length <= 512
  );
}

function isAllowedSessionRequest(body: unknown): boolean {
  if (
    !isJsonObject(body) ||
    Object.keys(body).some((key) => !ALLOWED_REQUEST_KEYS.has(key)) ||
    !isOptionalString(body.room_name, 128) ||
    !isOptionalString(body.participant_identity, 128) ||
    !isOptionalString(body.participant_name, 128) ||
    !isOptionalString(body.participant_metadata, 2_048) ||
    !hasValidParticipantAttributes(body.participant_attributes)
  ) {
    return false;
  }

  const roomConfig = body.room_config;
  if (
    !isJsonObject(roomConfig) ||
    Object.keys(roomConfig).some((key) => key !== 'agents') ||
    !Array.isArray(roomConfig.agents) ||
    roomConfig.agents.length !== 1
  ) {
    return false;
  }

  const agent = roomConfig.agents[0];
  return (
    isJsonObject(agent) &&
    Object.keys(agent).every((key) => key === 'agent_name') &&
    agent.agent_name === AGENT_NAME
  );
}

function getServerConfig(): ServerConfig | null {
  const values = {
    LIVEKIT_URL: process.env.LIVEKIT_URL,
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.error(`TOKEN_ENDPOINT_CONFIG_ERROR | missing=${missing.join(',')}`);
    return null;
  }

  try {
    if (new URL(values.LIVEKIT_URL!).protocol !== 'wss:') {
      console.error('TOKEN_ENDPOINT_CONFIG_ERROR | invalid=LIVEKIT_URL_SCHEME');
      return null;
    }
  } catch {
    console.error('TOKEN_ENDPOINT_CONFIG_ERROR | invalid=LIVEKIT_URL');
    return null;
  }

  return {
    livekitUrl: values.LIVEKIT_URL!,
    apiKey: values.LIVEKIT_API_KEY!,
    apiSecret: values.LIVEKIT_API_SECRET!,
  };
}

function logValidationError(reason: string, status: number) {
  console.warn(`TOKEN_REQUEST_VALIDATION_ERROR | reason=${reason} | status=${status}`);
}

function safeErrorCategory(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'UnknownError';
}

export async function POST(req: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  console.info('TOKEN_REQUEST_STARTED');

  try {
    const config = getServerConfig();
    if (!config) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500, headers });
    }

    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      logValidationError('content_type', 415);
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 415, headers }
      );
    }

    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      logValidationError('body_too_large', 413);
      return NextResponse.json({ error: 'Request body is too large' }, { status: 413, headers });
    }

    let body: unknown;
    try {
      const rawBody = await req.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
        logValidationError('body_too_large', 413);
        return NextResponse.json({ error: 'Request body is too large' }, { status: 413, headers });
      }
      body = JSON.parse(rawBody);
    } catch {
      logValidationError('invalid_json', 400);
      return NextResponse.json({ error: 'Invalid JSON request' }, { status: 400, headers });
    }

    if (!isAllowedSessionRequest(body)) {
      logValidationError('unsupported_session_configuration', 400);
      return NextResponse.json(
        { error: 'Unsupported session configuration' },
        { status: 400, headers }
      );
    }

    const sessionId = randomUUID();
    const participantIdentity = `ava-web-${sessionId}`;
    const roomName = `ava-demo-${sessionId}`;

    const token = new AccessToken(config.apiKey, config.apiSecret, {
      identity: participantIdentity,
      name: 'Website visitor',
      ttl: '10m',
    });
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE],
      canPublishData: false,
      canSubscribe: true,
      canUpdateOwnMetadata: false,
    });
    token.roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })],
    });

    const participantToken = await token.toJwt();
    console.info(`TOKEN_REQUEST_OK | agent=${AGENT_NAME}`);

    return NextResponse.json(
      {
        server_url: config.livekitUrl,
        participant_token: participantToken,
      },
      { status: 201, headers }
    );
  } catch (error) {
    console.error(`TOKEN_GENERATION_ERROR | category=${safeErrorCategory(error)}`);
    return NextResponse.json(
      { error: 'Unable to start a voice session' },
      { status: 500, headers }
    );
  }
}
