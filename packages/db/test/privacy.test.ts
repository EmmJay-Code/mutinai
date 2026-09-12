import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { ANONYMOUS, canView, findPrivateKeys, MODERATION_STATUSES, VISIBILITIES, type Viewer } from '@mutinai/domain';
import { createTestDatabase, resetAndSeed } from '../src/testing';
import * as s from '../src/schema';
import * as catalog from '../src/queries/catalog';
import * as community from '../src/queries/community';
import * as compatQueries from '../src/queries/compat';
import { castVote, CommunityError, createBenchmarkSubmission, upsertReview } from '../src/queries/mutations';
import { createAccountWithProfile, createSession, deleteAccount, exportAccountData, resolveSession } from '../src/identity';
import { visibleTo } from '../src/visibility';
import type { DatabaseHandle } from '../src/client';

let h: DatabaseHandle;
const PRIVATE_STRINGS = ['kestrel@example.org', 'ops@basement.example', 'Office Mac mini (do not share)'];

async function viewerFor(handle: string): Promise<Viewer> {
  const [p] = await h.db.select({ id: s.profile.id, accountId: s.profile.accountId }).from(s.profile).where(eq(s.profile.handle, handle));
  const roles = await h.db.select({ role: s.accountRole.role }).from(s.accountRole).where(eq(s.accountRole.accountId, p!.accountId));
  return { kind: 'user', profileId: p!.id, roles: roles.map((r) => r.role as 'moderator') };
}

function assertNoLeaks(payload: unknown) {
  expect(findPrivateKeys(payload)).toEqual([]);
  const text = JSON.stringify(payload);
  for (const secret of PRIVATE_STRINGS) expect(text).not.toContain(secret);
}

beforeAll(async () => {
  h = createTestDatabase();
  await resetAndSeed(h.db);
});
afterAll(() => h.close());

describe('SQL visibility filter mirrors the domain policy', () => {
  it('matches canView for every visibility × status × viewer × mode', async () => {
    const owner = await createAccountWithProfile(h.db, { authProvider: 'test', authSubject: 'matrix-owner', handle: 'matrix-owner', displayName: 'Owner' });
    const other = await createAccountWithProfile(h.db, { authProvider: 'test', authSubject: 'matrix-other', handle: 'matrix-other', displayName: 'Other' });
    const mod = await createAccountWithProfile(h.db, { authProvider: 'test', authSubject: 'matrix-mod', handle: 'matrix-mod', displayName: 'Mod', roles: ['moderator'] });
    const combos = VISIBILITIES.flatMap((visibility) => MODERATION_STATUSES.map((status) => ({ visibility, status })));
    const inserted = await h.db
      .insert(s.userHardwareConfig)
      .values(combos.map((c) => ({ ownerProfileId: owner.profileId, name: `matrix ${c.visibility} ${c.status}`, ...c })))
      .returning();

    const viewers: Viewer[] = [
      ANONYMOUS,
      { kind: 'user', profileId: owner.profileId, roles: [] },
      { kind: 'user', profileId: other.profileId, roles: [] },
      { kind: 'user', profileId: mod.profileId, roles: ['moderator'] },
    ];
    const cols = { visibility: s.userHardwareConfig.visibility, status: s.userHardwareConfig.status, owner: s.userHardwareConfig.ownerProfileId };
    for (const viewer of viewers) {
      for (const mode of ['direct', 'listing'] as const) {
        const visible = await h.db
          .select({ id: s.userHardwareConfig.id })
          .from(s.userHardwareConfig)
          .where(sql`${inArray(s.userHardwareConfig.id, inserted.map((r) => r.id))} and ${visibleTo(viewer, cols, mode)}`);
        const expected = inserted.filter((r) => canView(viewer, { visibility: r.visibility, status: r.status, ownerProfileId: r.ownerProfileId }, mode)).map((r) => r.id);
        expect(new Set(visible.map((v) => v.id))).toEqual(new Set(expected));
      }
    }
  });
});

describe('public surfaces never expose private data', () => {
  it('catalog, community listings, profiles and compat payloads contain no private keys or values', async () => {
    const model = await catalog.getModelDetail(h.db, 'qwen3-30b-a3b');
    const payloads = [
      model,
      await catalog.listModels(h.db),
      await catalog.getDeviceDetail(h.db, 'apple-m4-pro-20c'),
      await catalog.searchEntities(h.db, 'qwen'),
      await catalog.getProvenance(h.db, model!.id),
      await community.listRecentReviews(h.db),
      await community.listSubmissions(h.db, {}),
      await community.getPublicProfile(h.db, 'kestrel'),
      await community.getPublicProfile(h.db, 'quietmodel'),
      await community.getCommunityStats(h.db),
    ];
    for (const p of payloads) assertNoLeaks(p);
  });

  it('anonymous listings exclude private, unlisted, rejected and removed content', async () => {
    const subs = await community.listSubmissions(h.db, {});
    expect(subs.every((x) => x.visibility === 'public' && x.status === 'published')).toBe(true);
    expect(subs.some((x) => x.artifact.slug === 'qwen2-5-14b-instruct--mlx-4bit')).toBe(false); // private
    expect(subs.some((x) => x.measurements.some((m) => m.value === 910))).toBe(false); // rejected
    const reviews = await community.listRecentReviews(h.db, ANONYMOUS, 100);
    expect(reviews.map((r) => r.title)).not.toContain('Check out my discount GPU store');
    expect(reviews.map((r) => r.title)).not.toContain('Notes on my mini (shared by link only)');
  });

  it('member hardware on a public submission discloses components but not the private configuration name', async () => {
    const [pub] = await community.listSubmissions(h.db, { submitterHandle: 'quietmodel' });
    expect(pub!.hardware).toMatchObject({ type: 'member', name: null, unifiedMemoryGb: 48 });
    if (pub!.hardware.type !== 'member') throw new Error('expected member hardware');
    expect(pub!.hardware.components.map((c) => c.slug)).toEqual(['apple-m4-pro-20c']);

    const owner = await viewerFor('quietmodel');
    const own = await community.listSubmissions(h.db, { submitterHandle: 'quietmodel' }, owner);
    expect(own).toHaveLength(2); // includes the private submission
    expect(own.every((x) => x.hardware.type === 'member' && x.hardware.name === 'Office Mac mini (do not share)')).toBe(true);
  });

  it('unlisted content is reachable directly but not listed; removed content is visible only to author and moderators', async () => {
    const [unlisted] = await h.db.select().from(s.review).where(eq(s.review.visibility, 'unlisted'));
    expect(await community.getReview(h.db, unlisted!.id)).not.toBeNull();
    const [removed] = await h.db.select().from(s.review).where(eq(s.review.status, 'removed'));
    expect(await community.getReview(h.db, removed!.id)).toBeNull();
    expect(await community.getReview(h.db, removed!.id, await viewerFor('basement-cluster'))).not.toBeNull();
    expect(await community.getReview(h.db, removed!.id, await viewerFor('kestrel'))).not.toBeNull();
    expect(await community.getReview(h.db, removed!.id, await viewerFor('tokenwright'))).toBeNull();
  });

  it('rating aggregates only count public published reviews', async () => {
    const phi = await catalog.getEntityRef(h.db, 'model_variant', 'phi-4');
    expect(await community.ratingAggregates(h.db, [phi!.id])).toEqual([]); // the only review was removed
    const mini = await catalog.getEntityRef(h.db, 'hardware_configuration', 'mac-mini-m4-pro-48gb');
    expect(await community.ratingAggregates(h.db, [mini!.id])).toEqual([]); // unlisted
  });

  it('private user hardware cannot be loaded into compat by other viewers', async () => {
    const [cfg] = await h.db.select().from(s.userHardwareConfig).where(eq(s.userHardwareConfig.visibility, 'private')).limit(1);
    expect(await compatQueries.loadUserHardware(h.db, ANONYMOUS, cfg!.id)).toBeNull();
    expect(await compatQueries.loadUserHardware(h.db, await viewerFor('tokenwright'), cfg!.id)).toBeNull();
    expect(await compatQueries.loadUserHardware(h.db, await viewerFor('quietmodel'), cfg!.id)).not.toBeNull();
  });

  it('private submissions never feed measured speeds', async () => {
    const measurements = await compatQueries.loadMeasurements(h.db);
    expect(measurements.some((m) => m.genTps === 21.8)).toBe(false);
    expect(measurements.some((m) => m.genTps === 910)).toBe(false);
  });
});

describe('write authorization', () => {
  it('anonymous viewers cannot write', async () => {
    const entity = await catalog.getEntityRef(h.db, 'project', 'vllm');
    await expect(upsertReview(h.db, ANONYMOUS, { entityId: entity!.id, title: 'Hello', body: 'Long enough body', visibility: 'public', ratings: [{ dimension: 'speed', score: 4 }] }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('members cannot submit results against someone else\'s hardware configuration', async () => {
    const [cfg] = await h.db.select().from(s.userHardwareConfig).where(eq(s.userHardwareConfig.name, 'Triple 3090 rack'));
    const artifact = await catalog.getEntityRef(h.db, 'model_artifact', 'llama-3-1-8b-instruct--q4-k-m');
    const runtime = await catalog.getEntityRef(h.db, 'project', 'llama-cpp');
    const [bench] = await catalog.listBenchmarks(h.db, 'performance');
    await expect(
      createBenchmarkSubmission(h.db, await viewerFor('tokenwright'), {
        artifactId: artifact!.id, benchmarkId: bench!.id, hardware: { userConfigId: cfg!.id }, runtimeId: runtime!.id, backend: 'cuda',
        visibility: 'public', measurements: [{ metricId: bench!.metrics[0]!.id, value: 10 }],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects runtime/format and backend mismatches', async () => {
    const artifact = await catalog.getEntityRef(h.db, 'model_artifact', 'llama-3-1-8b-instruct--mlx-4bit');
    const runtime = await catalog.getEntityRef(h.db, 'project', 'llama-cpp');
    const config = await catalog.getEntityRef(h.db, 'hardware_configuration', 'rtx-4090-workstation');
    const bench = (await catalog.listBenchmarks(h.db, 'performance')).find((b) => b.slug === 'llama-bench')!;
    const base = { benchmarkId: bench.id, hardware: { configurationId: config!.id }, runtimeId: runtime!.id, visibility: 'public', measurements: [{ metricId: bench.metrics[0]!.id, value: 10 }] };
    await expect(createBenchmarkSubmission(h.db, await viewerFor('tokenwright'), { ...base, artifactId: artifact!.id, backend: 'cuda' })).rejects.toThrow(/does not load mlx/);
    const gguf = await catalog.getEntityRef(h.db, 'model_artifact', 'llama-3-1-8b-instruct--q4-k-m');
    await expect(createBenchmarkSubmission(h.db, await viewerFor('tokenwright'), { ...base, artifactId: gguf!.id, backend: 'metal' })).rejects.toThrow(/not available/);
  });

  it('members cannot vote on their own contributions or on content they cannot see', async () => {
    const [own] = await h.db.select().from(s.review).innerJoin(s.profile, eq(s.profile.id, s.review.authorProfileId)).where(eq(s.profile.handle, 'kestrel')).limit(1);
    await expect(castVote(h.db, await viewerFor('kestrel'), { reviewId: own!.review.id }, 1)).rejects.toBeInstanceOf(CommunityError);
    const [priv] = await h.db.select().from(s.benchmarkSubmission).where(eq(s.benchmarkSubmission.visibility, 'private'));
    await expect(castVote(h.db, await viewerFor('kestrel'), { submissionId: priv!.id }, 1)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rating validation is enforced on write', async () => {
    const device = await catalog.getEntityRef(h.db, 'hardware_device', 'nvidia-rtx-5090');
    await expect(upsertReview(h.db, await viewerFor('tokenwright'), { entityId: device!.id, title: 'Fast card', body: 'Very fast for 32B models.', visibility: 'public', ratings: [{ dimension: 'coding', score: 5 }] }))
      .rejects.toThrow(/does not apply/);
  });
});

describe('sessions, export and deletion', () => {
  const SECRET = 'test-secret';

  it('stores only a hash of the session token and resolves it to a viewer', async () => {
    const [p] = await h.db.select().from(s.profile).where(eq(s.profile.handle, 'kestrel'));
    const { token } = await createSession(h.db, p!.accountId, SECRET);
    const stored = await h.db.select().from(s.session).where(eq(s.session.accountId, p!.accountId));
    expect(stored.some((x) => x.tokenHash === token)).toBe(false);
    const ctx = await resolveSession(h.db, token, SECRET);
    expect(ctx?.viewer).toEqual({ kind: 'user', profileId: p!.id, roles: ['moderator'] });
    expect(await resolveSession(h.db, token, 'wrong-secret')).toBeNull();
  });

  it('exports all of a member\'s data and nothing of anyone else\'s', async () => {
    const viewer = await viewerFor('quietmodel');
    if (viewer.kind !== 'user') throw new Error();
    const data = await exportAccountData(h.db, viewer.profileId);
    expect(data.hardwareConfigurations.map((c) => c.name)).toEqual(['Office Mac mini (do not share)']);
    expect(data.benchmarkSubmissions).toHaveLength(2);
    expect(data.reviews).toHaveLength(2);
    expect(data.account.preferences?.allowAiTrainingUse).toBe(false);
    const text = JSON.stringify(data);
    expect(text).not.toContain('kestrel@example.org');
    expect(text).not.toContain('Triple 3090 rack');
  });

  it('deletes the account, profile and all authored content', async () => {
    const viewer = await viewerFor('basement-cluster');
    if (viewer.kind !== 'user') throw new Error();
    await deleteAccount(h.db, viewer.profileId);
    const counts = await h.db.execute<{ profiles: number; accounts: number; reviews: number; subs: number; configs: number; envs: number; votes: number }>(sql`
      select (select count(*)::int from community.profile where handle = 'basement-cluster') as profiles,
        (select count(*)::int from identity.account where auth_subject = 'basement-cluster') as accounts,
        (select count(*)::int from community.review where author_profile_id = ${viewer.profileId}) as reviews,
        (select count(*)::int from community.benchmark_submission where submitter_profile_id = ${viewer.profileId}) as subs,
        (select count(*)::int from community.user_hardware_config where owner_profile_id = ${viewer.profileId}) as configs,
        (select count(*)::int from ecosystem.run_environment e where e.hardware_configuration_id is null and not exists (select 1 from community.benchmark_submission b where b.environment_id = e.id)) as envs,
        (select count(*)::int from community.vote where voter_profile_id = ${viewer.profileId}) as votes`);
    expect(counts[0]).toEqual({ profiles: 0, accounts: 0, reviews: 0, subs: 0, configs: 0, envs: 0, votes: 0 });
    expect(await community.getPublicProfile(h.db, 'basement-cluster')).toBeNull();
  });
});
