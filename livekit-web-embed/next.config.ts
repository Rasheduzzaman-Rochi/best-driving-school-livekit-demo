import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  async headers() {
    const iframeHeaders = [
      { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
      { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), display-capture=()' },
    ];
    return [{ source: '/embed', headers: iframeHeaders }];
  },
};

export default nextConfig;
