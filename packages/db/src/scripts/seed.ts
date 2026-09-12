import { createDatabase } from '../client';
import { requireEnv } from '../env';
import { seedDatabase } from '../seed';

const { db, close } = createDatabase(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const started = Date.now();
  await seedDatabase(db, { community: !process.argv.includes('--catalog-only') });
  console.log(`seeded in ${Date.now() - started}ms`);
} finally {
  await close();
}
