import { requireEnv } from '../env';
import { dropAll, runMigrations } from '../migrate';

const url = requireEnv('DATABASE_URL');
if (process.env.NODE_ENV === 'production') throw new Error('refusing to reset in production');
await dropAll(url);
await runMigrations(url);
console.log('database reset and migrated');
