import { getDb, pingDatabase } from '@mutinai/db';

const headers = { 'Cache-Control': 'no-store' };

/** Liveness and database reachability for the host's health check. Reveals no configuration or error detail. */
export async function GET() {
  try {
    await pingDatabase(getDb());
    return Response.json({ status: 'ok' }, { headers });
  } catch (error) {
    console.error('health check failed', error);
    return Response.json({ status: 'unavailable' }, { status: 503, headers });
  }
}
