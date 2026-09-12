import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './src/env';

loadEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  schemaFilter: ['ecosystem', 'ingest', 'identity', 'community', 'jobs'],
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
});
