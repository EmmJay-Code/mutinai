'use server';

import { CommunityError, getDb, identity, mutations, requireEnv } from '@mutinai/db';
import { RATING_DIMENSIONS, isModerator } from '@mutinai/domain';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { INFO_MODE_COOKIE } from '@/lib/info-mode';
import { devLoginEnabled, getSession, getViewer, SESSION_COOKIE } from '@/lib/session';

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
};
const num = (fd: FormData, key: string) => {
  const v = str(fd, key);
  return v === '' ? null : Number(v);
};

/** Only allow same-site relative return paths. */
function safeReturn(path: string, fallback = '/'): string {
  return path.startsWith('/') && !path.startsWith('//') ? path : fallback;
}

function withError(path: string, error: unknown): string {
  const message = error instanceof CommunityError ? error.message : 'Something went wrong';
  if (!(error instanceof CommunityError)) console.error(error);
  const url = new URL(path, 'http://local');
  url.searchParams.set('error', message);
  return url.pathname + url.search + url.hash;
}

export async function signIn(formData: FormData) {
  if (!devLoginEnabled()) throw new Error('development sign-in is disabled');
  const handle = str(formData, 'handle');
  const accounts = await identity.listDevAccounts(getDb());
  const account = accounts.find((a) => a.handle === handle);
  if (!account) redirect('/signin?error=Unknown%20account');
  const { token, expiresAt } = await identity.createSession(getDb(), account.accountId, requireEnv('SESSION_SECRET'));
  const secure = (await headers()).get('x-forwarded-proto') === 'https';
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, path: '/', expires: expiresAt });
  redirect(safeReturn(str(formData, 'returnTo'), '/me'));
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await identity.deleteSession(getDb(), token, requireEnv('SESSION_SECRET'));
  jar.delete(SESSION_COOKIE);
  redirect('/');
}

async function requireSignedIn(returnTo: string) {
  const session = await getSession();
  if (!session) redirect(`/signin?returnTo=${encodeURIComponent(returnTo)}`);
  return session;
}

export async function submitReview(formData: FormData) {
  const returnTo = safeReturn(str(formData, 'returnTo'));
  const session = await requireSignedIn(returnTo);
  const ratings = RATING_DIMENSIONS.flatMap((d) => {
    const score = num(formData, `rating_${d.key}`);
    return score ? [{ dimension: d.key, score }] : [];
  });
  let target = returnTo;
  try {
    await mutations.upsertReview(getDb(), session.viewer, {
      entityId: str(formData, 'entityId'),
      title: str(formData, 'title'),
      body: str(formData, 'body'),
      visibility: str(formData, 'visibility') || 'public',
      hardwareConfigurationId: str(formData, 'hardwareConfigurationId') || null,
      ratings,
    });
    revalidatePath(returnTo.split('#')[0]!);
  } catch (error) {
    target = withError(`/contribute/review?entity=${encodeURIComponent(str(formData, 'entityRef'))}&returnTo=${encodeURIComponent(returnTo)}`, error);
  }
  redirect(target);
}

export async function createHardwareConfig(formData: FormData) {
  const session = await requireSignedIn('/me');
  const components = [0, 1, 2].flatMap((i) => {
    const deviceId = str(formData, `device_${i}`);
    const count = num(formData, `count_${i}`) ?? 1;
    return deviceId ? [{ deviceId, count }] : [];
  });
  let target = '/me?saved=config';
  try {
    await mutations.createUserHardwareConfig(getDb(), session.viewer, {
      name: str(formData, 'name'),
      visibility: str(formData, 'visibility') || 'private',
      components,
      systemRamGb: num(formData, 'systemRamGb') ?? 0,
      unifiedMemoryGb: num(formData, 'unifiedMemoryGb'),
      systemRamBandwidthGbps: num(formData, 'systemRamBandwidthGbps'),
    });
  } catch (error) {
    target = withError('/me', error);
  }
  redirect(target);
}

export async function submitBenchmark(formData: FormData) {
  const session = await requireSignedIn('/contribute/benchmark');
  const hardware = str(formData, 'hardware');
  const [hwKind, hwId] = hardware.split(':');
  const measurements = formData
    .getAll('metricId')
    .map(String)
    .flatMap((metricId) => {
      const value = num(formData, `metric_${metricId}`);
      return value != null ? [{ metricId, value }] : [];
    });
  let target = '/community?submitted=1';
  try {
    const id = await mutations.createBenchmarkSubmission(getDb(), session.viewer, {
      artifactId: str(formData, 'artifactId'),
      benchmarkId: str(formData, 'benchmarkId'),
      hardware: hwKind === 'user' ? { userConfigId: hwId ?? '' } : { configurationId: hwId ?? '' },
      runtimeId: str(formData, 'runtimeId'),
      runtimeVersion: str(formData, 'runtimeVersion') || null,
      backend: str(formData, 'backend'),
      contextLength: num(formData, 'contextLength'),
      batchSize: num(formData, 'batchSize'),
      gpuLayers: num(formData, 'gpuLayers'),
      kvCacheType: str(formData, 'kvCacheType') || null,
      flashAttention: formData.get('flashAttention') === 'on' ? true : null,
      os: str(formData, 'os') || null,
      driverVersion: str(formData, 'driverVersion') || null,
      notes: str(formData, 'notes') || null,
      visibility: str(formData, 'visibility') || 'public',
      measurements,
    });
    target = `/community?submitted=${id}`;
    revalidatePath('/community');
  } catch (error) {
    const params = new URLSearchParams();
    for (const key of ['benchmarkId', 'artifactId']) if (str(formData, key)) params.set(key, str(formData, key));
    target = withError(`/contribute/benchmark?${params}`, error);
  }
  redirect(target);
}

export async function vote(formData: FormData) {
  const referer = (await headers()).get('referer');
  const back = referer ? new URL(referer).pathname + new URL(referer).search : '/community';
  const session = await requireSignedIn(back);
  const reviewId = str(formData, 'reviewId');
  const submissionId = str(formData, 'submissionId');
  const value = num(formData, 'value') === -1 ? -1 : 1;
  let target = back;
  try {
    await mutations.castVote(getDb(), session.viewer, reviewId ? { reviewId } : { submissionId }, value);
    revalidatePath(back.split('?')[0]!);
  } catch (error) {
    target = withError(back, error);
  }
  redirect(target);
}

export async function verifySubmission(formData: FormData) {
  const viewer = await getViewer();
  if (!isModerator(viewer)) redirect('/community?error=Moderators%20only');
  const state = str(formData, 'state') as 'verified' | 'disputed' | 'unverified';
  let target = '/community';
  try {
    await mutations.setSubmissionVerification(getDb(), viewer, str(formData, 'submissionId'), state);
    revalidatePath('/community');
  } catch (error) {
    target = withError('/community', error);
  }
  redirect(target);
}

export async function deleteMyAccount(formData: FormData) {
  const session = await requireSignedIn('/me');
  if (str(formData, 'confirm') !== session.profile.handle) redirect('/me?error=Type%20your%20handle%20to%20confirm%20deletion');
  await identity.deleteAccount(getDb(), session.profile.id);
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/?deleted=1');
}

/** Remembers the directory presentation for this browser. Not personal data; works signed out. */
export async function setInfoMode(formData: FormData) {
  const mode = str(formData, 'mode') === 'technical' ? 'technical' : 'simple';
  (await cookies()).set(INFO_MODE_COOKIE, mode, { sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  redirect(safeReturn(str(formData, 'returnTo')));
}
