'use client';

import { useMemo } from 'react';
import { LogLevel, TokenSource, setLogLevel } from 'livekit-client';
import { SessionProvider, useSession } from '@livekit/components-react';
import type { AppConfig } from '@/lib/types';
import { SessionView } from './session-view';

setLogLevel(LogLevel.warn);

const AGENT_READY_TIMEOUT_MILLISECONDS = 30_000;

interface AppProps {
  appConfig: AppConfig;
}

function EmbedAgentClient({ appConfig }: AppProps) {
  const tokenSource = useMemo(() => TokenSource.endpoint('/api/connection-details'), []);
  const session = useSession(tokenSource, {
    agentName: 'livekit-agent',
    agentConnectTimeoutMilliseconds: AGENT_READY_TIMEOUT_MILLISECONDS,
  });

  return (
    <SessionProvider session={session}>
      <SessionView appConfig={appConfig} />
    </SessionProvider>
  );
}

export default EmbedAgentClient;
