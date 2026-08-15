import type { AppConfig } from './lib/types';

export const APP_CONFIG_DEFAULTS: AppConfig = {
  sandboxId: undefined,
  agentName: 'livekit-agent',
  supportsChatInput: false,
  supportsVideoInput: false,
  supportsScreenShare: false,
  isPreConnectBufferEnabled: true,
  startButtonText: 'Start Conversation',
  companyName: 'Best Driving School',
  accent: '#147c74',
  accentDark: '#0f625c',
  logo: undefined,
  logoDark: undefined,
};
