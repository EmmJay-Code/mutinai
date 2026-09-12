import { getDb, identity } from '@mutinai/db';
import { getSession } from '@/lib/session';

/** Full export of the signed-in member's data. Private: never cached. */
export async function GET() {
  const session = await getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const data = await identity.exportAccountData(getDb(), session.profile.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="mutinai-export-${session.profile.handle}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
