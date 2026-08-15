'use client';

import { useMemo } from 'react';
import { TokenSource } from 'livekit-client';
import { SessionProvider, useSession } from '@livekit/components-react';
import type { AppConfig } from '@/lib/types';
import { SessionView } from './session-view';

interface AppProps {
  appConfig: AppConfig;
}

function EmbedAgentClient({ appConfig }: AppProps) {
  const tokenSource = useMemo(
    () =>
      TokenSource.endpoint(
        process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details'
      ),
    []
  );
  const session = useSession(tokenSource, {
    agentName: 'livekit-agent',
    agentConnectTimeoutMilliseconds: 20_000,
  });

  return (
    <SessionProvider session={session}>
      <SessionView appConfig={appConfig} />
    </SessionProvider>
  );
}

export default EmbedAgentClient;
