import { NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import { RoomAgentDispatch, RoomConfiguration, TrackSource } from '@livekit/protocol';

// NOTE: you are expected to define the following environment variables in `.env.local`:
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const AGENT_NAME = 'livekit-agent';
const MAX_REQUEST_BYTES = 4_096;

// don't cache the results
export const revalidate = 0;

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllowedSessionRequest(body: unknown): boolean {
  if (!isJsonObject(body) || Object.keys(body).some((key) => key !== 'room_config')) {
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

export async function POST(req: Request) {
  const headers = { 'Cache-Control': 'no-store' };

  try {
    if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
      console.error('LiveKit connection endpoint is missing required server configuration.');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500, headers });
    }

    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 415, headers }
      );
    }

    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: 'Request body is too large' }, { status: 413, headers });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request' }, { status: 400, headers });
    }

    if (!isAllowedSessionRequest(body)) {
      return NextResponse.json(
        { error: 'Unsupported session configuration' },
        { status: 400, headers }
      );
    }

    const sessionId = randomUUID();
    const participantIdentity = `ava-web-${sessionId}`;
    const roomName = `ava-demo-${sessionId}`;

    const token = new AccessToken(API_KEY, API_SECRET, {
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

    return NextResponse.json(
      {
        server_url: LIVEKIT_URL,
        participant_token: await token.toJwt(),
      },
      { status: 201, headers }
    );
  } catch (error) {
    console.error('Failed to generate a LiveKit participant token.', error);
    return NextResponse.json(
      { error: 'Unable to start a voice session' },
      { status: 500, headers }
    );
  }
}
