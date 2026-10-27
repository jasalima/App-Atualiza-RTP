import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // pdfkit reads its standard-font metrics (js/data/*.afm) from disk at runtime;
  // bundling it broke that path in production (ENOENT Helvetica.afm), so it is
  // loaded from node_modules and its data folder is traced into the export route.
  serverExternalPackages: ['pdf-parse', 'mammoth', 'pdfkit'],
  outputFileTracingIncludes: {
    '/api/reports/*/export/*': ['./node_modules/pdfkit/js/data/**/*'],
    '/api/travel/export': ['./node_modules/pdfkit/js/data/**/*'],
    '/api/travel/send': ['./node_modules/pdfkit/js/data/**/*'],
    '/api/documents/send': ['./node_modules/pdfkit/js/data/**/*']
  },
  async headers() {
    return [{
      source: '/sw.js',
      headers: [
        { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" }
      ]
    }];
  },
  experimental: { serverActions: { bodySizeLimit: '20mb' } }
};

export default nextConfig;
