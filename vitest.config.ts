import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/domain/test/**/*.test.ts', 'packages/ingestion/test/unit/**/*.test.ts'],
        },
      },
      {
        // Integration tests run against TEST_DATABASE_URL, sequentially, on a freshly migrated database.
        test: {
          name: 'integration',
          include: ['packages/db/test/**/*.test.ts', 'packages/ingestion/test/integration/**/*.test.ts'],
          globalSetup: ['packages/db/test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
