import { requireEnv } from '../env';
import { runMigrations } from '../migrate';

const url = requireEnv('DATABASE_URL');
await runMigrations(url);
console.log('migrations applied');
