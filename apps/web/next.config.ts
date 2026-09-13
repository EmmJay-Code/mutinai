import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const repoRoot = resolve(import.meta.dirname, '../..');
const envFile = resolve(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config: NextConfig = {
  transpilePackages: ['@mutinai/domain', '@mutinai/db'],
  serverExternalPackages: ['postgres'],
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Permissions-Policy', value: 'interest-cohort=(), browsing-topics=()' },
          // Resolved at build time: keeps every response (pages and API) out of search indexes until MUTINAI_ALLOW_INDEXING=1.
          ...(process.env.MUTINAI_ALLOW_INDEXING === '1' ? [] : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]),
        ],
      },
    ];
  },
};

export default config;
