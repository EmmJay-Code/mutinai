/**
 * Accounts, sessions, export and deletion. PRIVATE module: nothing here may be used to build public payloads.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { Role, Viewer } from '@mutinai/domain';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Database, Executor } from './client';
import * as s from './schema';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionContext {
  viewer: Viewer;
  profile: { id: string; handle: string; displayName: string };
}

function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export async function createAccountWithProfile(
  db: Executor,
  input: { authProvider: string; authSubject: string; email?: string | null; handle: string; displayName: string; bio?: string | null; roles?: Role[] },
): Promise<{ accountId: string; profileId: string }> {
  const [acct] = await db
    .insert(s.account)
    .values({ authProvider: input.authProvider, authSubject: input.authSubject, email: input.email ?? null })
    .returning({ id: s.account.id });
  await db.insert(s.accountPreference).values({ accountId: acct!.id });
  if (input.roles?.length) await db.insert(s.accountRole).values(input.roles.map((role) => ({ accountId: acct!.id, role })));
  const [prof] = await db
    .insert(s.profile)
    .values({ accountId: acct!.id, handle: input.handle, displayName: input.displayName, bio: input.bio ?? null })
    .returning({ id: s.profile.id });
  return { accountId: acct!.id, profileId: prof!.id };
}

export async function createSession(db: Executor, accountId: string, secret: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(s.session).values({ accountId, tokenHash: hashToken(token, secret), expiresAt });
  return { token, expiresAt };
}

export async function resolveSession(db: Executor, token: string | undefined, secret: string): Promise<SessionContext | null> {
  if (!token) return null;
  const rows = await db
    .select({ accountId: s.session.accountId, profileId: s.profile.id, handle: s.profile.handle, displayName: s.profile.displayName })
    .from(s.session)
    .innerJoin(s.profile, eq(s.profile.accountId, s.session.accountId))
    .where(and(eq(s.session.tokenHash, hashToken(token, secret)), gt(s.session.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const roles = await db.select({ role: s.accountRole.role }).from(s.accountRole).where(eq(s.accountRole.accountId, row.accountId));
  return {
    viewer: { kind: 'user', profileId: row.profileId, roles: roles.map((r) => r.role as Role) },
    profile: { id: row.profileId, handle: row.handle, displayName: row.displayName },
  };
}

export async function deleteSession(db: Executor, token: string, secret: string): Promise<void> {
  await db.delete(s.session).where(eq(s.session.tokenHash, hashToken(token, secret)));
}

/** Development-only sign-in candidates. Callers must gate on MUTINAI_DEV_LOGIN. */
export async function listDevAccounts(db: Executor) {
  return db
    .select({ accountId: s.account.id, handle: s.profile.handle, displayName: s.profile.displayName })
    .from(s.account)
    .innerJoin(s.profile, eq(s.profile.accountId, s.account.id))
    .where(eq(s.account.authProvider, 'dev'))
    .orderBy(s.profile.handle);
}

async function accountIdForProfile(db: Executor, profileId: string): Promise<string> {
  const [row] = await db.select({ accountId: s.profile.accountId }).from(s.profile).where(eq(s.profile.id, profileId));
  if (!row) throw new Error('profile not found');
  return row.accountId;
}

/** Everything Mutinai holds about the signed-in user, in a portable shape. */
export async function exportAccountData(db: Executor, profileId: string) {
  const accountId = await accountIdForProfile(db, profileId);
  const [acct] = await db.select().from(s.account).where(eq(s.account.id, accountId));
  const [prefs] = await db.select().from(s.accountPreference).where(eq(s.accountPreference.accountId, accountId));
  const [prof] = await db.select().from(s.profile).where(eq(s.profile.id, profileId));
  const roles = await db.select({ role: s.accountRole.role }).from(s.accountRole).where(eq(s.accountRole.accountId, accountId));
  const configs = await db.select().from(s.userHardwareConfig).where(eq(s.userHardwareConfig.ownerProfileId, profileId));
  const components = configs.length
    ? await db.select().from(s.userHardwareConfigComponent).where(inArray(s.userHardwareConfigComponent.configId, configs.map((c) => c.id)))
    : [];
  const reviews = await db.select().from(s.review).where(eq(s.review.authorProfileId, profileId));
  const ratings = reviews.length ? await db.select().from(s.reviewRating).where(inArray(s.reviewRating.reviewId, reviews.map((r) => r.id))) : [];
  const submissions = await db.select().from(s.benchmarkSubmission).where(eq(s.benchmarkSubmission.submitterProfileId, profileId));
  const environments = submissions.length
    ? await db.select().from(s.runEnvironment).where(inArray(s.runEnvironment.id, submissions.map((x) => x.environmentId)))
    : [];
  const measurements = submissions.length
    ? await db.select().from(s.submissionMeasurement).where(inArray(s.submissionMeasurement.submissionId, submissions.map((x) => x.id)))
    : [];
  const votes = await db.select().from(s.vote).where(eq(s.vote.voterProfileId, profileId));
  return {
    exportedAt: new Date().toISOString(),
    format: 'mutinai-account-export/v1',
    account: { createdAt: acct!.createdAt, authProvider: acct!.authProvider, email: acct!.email, preferences: prefs, roles: roles.map((r) => r.role) },
    profile: prof,
    hardwareConfigurations: configs.map((c) => ({ ...c, components: components.filter((x) => x.configId === c.id) })),
    reviews: reviews.map((r) => ({ ...r, ratings: ratings.filter((x) => x.reviewId === r.id) })),
    benchmarkSubmissions: submissions.map((x) => ({
      ...x,
      environment: environments.find((e) => e.id === x.environmentId),
      measurements: measurements.filter((m) => m.submissionId === x.id),
    })),
    votes,
  };
}

/**
 * Deletes an account and all user-authored content. Run environments are owned by submissions and are
 * removed explicitly because the FK points from submission to environment.
 */
export async function deleteAccount(db: Database, profileId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const accountId = await accountIdForProfile(tx, profileId);
    const subs = await tx
      .select({ id: s.benchmarkSubmission.id, environmentId: s.benchmarkSubmission.environmentId })
      .from(s.benchmarkSubmission)
      .where(eq(s.benchmarkSubmission.submitterProfileId, profileId));
    if (subs.length) {
      await tx.delete(s.benchmarkSubmission).where(inArray(s.benchmarkSubmission.id, subs.map((x) => x.id)));
      await tx.delete(s.runEnvironment).where(inArray(s.runEnvironment.id, subs.map((x) => x.environmentId)));
    }
    // Environments of *other* users' submissions can never reference this user's configs (enforced on write),
    // so cascading the account → profile → configs is safe.
    await tx.delete(s.account).where(eq(s.account.id, accountId));
  });
}
