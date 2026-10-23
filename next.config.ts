import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // pdfkit reads its standard-font metrics (js/data/*.afm) from disk at runtime;
  // bundling it broke that path in production (ENOENT Helvetica.afm), so it is
  // loaded from node_modules and its data folder is traced into the export route.
  serverExternalPackages: ['pdf-parse', 'mammoth', 'pdfkit'],
  outputFileTracingIncludes: {
    '/api/reports/*/export/*': ['./node_modules/pdfkit/js/data/**/*']
  },
  experimental: { serverActions: { bodySizeLimit: '20mb' } }
};

export default nextConfig;
