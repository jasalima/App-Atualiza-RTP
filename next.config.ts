import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pdf-parse', 'mammoth'],
  experimental: { serverActions: { bodySizeLimit: '20mb' } }
};

export default nextConfig;
