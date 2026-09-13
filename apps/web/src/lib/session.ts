import { ANONYMOUS, type Viewer } from '@mutinai/domain';
import { getDb, identity, requireEnv } from '@mutinai/db';
import { cookies } from 'next/headers';
import { cache } from 'react';

export const SESSION_COOKIE = 'mutinai_session';

export const devLoginEnabled = () => process.env.MUTINAI_DEV_LOGIN === '1' && process.env.NODE_ENV !== 'production';

/** Development sign-in is the only identity provider, so it also gates every community write. */
export const contributionsEnabled = devLoginEnabled;

/** Resolves the current session once per request. */
export const getSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  // Without an identity provider no session is valid, whatever cookie is presented.
  if (!token || !devLoginEnabled()) return null;
  return identity.resolveSession(getDb(), token, requireEnv('SESSION_SECRET'));
});

export async function getViewer(): Promise<Viewer> {
  return (await getSession())?.viewer ?? ANONYMOUS;
}
