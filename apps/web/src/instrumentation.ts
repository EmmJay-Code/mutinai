/** Fails fast on missing configuration when a production server starts, rather than on the first request. */
export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (process.env.MUTINAI_DEV_LOGIN === '1') {
    console.warn('MUTINAI_DEV_LOGIN=1 is ignored in production: development sign-in and community writes stay disabled.');
  }
}
