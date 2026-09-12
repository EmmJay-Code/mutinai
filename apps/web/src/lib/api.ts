import { assertNoPrivateKeys } from '@mutinai/domain';

/** Public API response. Asserts no private fields slipped into the payload (defence in depth). */
export function publicJson(data: unknown, init: { status?: number; maxAge?: number } = {}): Response {
  assertNoPrivateKeys(data);
  return new Response(JSON.stringify({ data }), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${init.maxAge ?? 60}`,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export const notFoundJson = () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
