/**
 * Community writes. Authorization and validation live here, not in route handlers,
 * so every entry point (server actions, API routes, future clients) gets identical rules.
 */
import {
  isModerator,
  isReviewableKind,
  RATING_DIMENSIONS,
  validateRatings,
  VERIFICATION_STATES,
  VISIBILITIES,
  type ComputeBackend,
  type ModerationStatus,
  type RatingInput,
  type VerificationState,
  type Viewer,
  type Visibility,
} from '@mutinai/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database, Executor } from '../client';
import { enqueueJob } from '../jobs';
import * as s from '../schema';

export class CommunityError extends Error {
  constructor(public readonly code: 'unauthenticated' | 'forbidden' | 'invalid' | 'not_found' | 'conflict', message: string) {
    super(message);
  }
}

function requireUser(viewer: Viewer): Extract<Viewer, { kind: 'user' }> {
  if (viewer.kind !== 'user') throw new CommunityError('unauthenticated', 'sign in to contribute');
  return viewer;
}

function requireVisibility(v: string): Visibility {
  if (!(VISIBILITIES as readonly string[]).includes(v)) throw new CommunityError('invalid', `invalid visibility ${v}`);
  return v as Visibility;
}

export interface ReviewInput {
  entityId: string;
  title: string;
  body: string;
  visibility: string;
  hardwareConfigurationId?: string | null;
  ratings: RatingInput[];
}

/** Creates or replaces the viewer's review of an entity (one review per member per entity). */
export async function upsertReview(db: Database, viewer: Viewer, input: ReviewInput): Promise<string> {
  const user = requireUser(viewer);
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 3 || title.length > 140) throw new CommunityError('invalid', 'title must be 3–140 characters');
  if (body.length < 10 || body.length > 10_000) throw new CommunityError('invalid', 'review must be 10–10,000 characters');
  const visibility = requireVisibility(input.visibility);

  const [target] = await db.select({ kind: s.entity.kind }).from(s.entity).where(eq(s.entity.id, input.entityId));
  if (!target) throw new CommunityError('not_found', 'entity not found');
  if (!isReviewableKind(target.kind)) throw new CommunityError('invalid', `${target.kind} cannot be reviewed`);
  const check = validateRatings(target.kind, input.ratings);
  if (!check.ok) throw new CommunityError('invalid', check.errors.join('; '));

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.review)
      .values({ authorProfileId: user.profileId, entityId: input.entityId, title, body, visibility, hardwareConfigurationId: input.hardwareConfigurationId || null })
      .onConflictDoUpdate({
        target: [s.review.authorProfileId, s.review.entityId],
        set: { title, body, visibility, hardwareConfigurationId: input.hardwareConfigurationId || null, updatedAt: new Date() },
      })
      .returning({ id: s.review.id });
    await tx.delete(s.reviewRating).where(eq(s.reviewRating.reviewId, row!.id));
    await tx.insert(s.reviewRating).values(input.ratings.map((r) => ({ reviewId: row!.id, dimension: r.dimension as (typeof RATING_DIMENSIONS)[number]['key'], score: r.score })));
    return row!.id;
  });
}

export interface UserHardwareInput {
  name: string;
  visibility: string;
  components: { deviceId: string; count: number }[];
  systemRamGb: number;
  systemRamBandwidthGbps?: number | null;
  unifiedMemoryGb?: number | null;
}

export async function createUserHardwareConfig(db: Database, viewer: Viewer, input: UserHardwareInput): Promise<string> {
  const user = requireUser(viewer);
  const name = input.name.trim();
  if (!name || name.length > 80) throw new CommunityError('invalid', 'name must be 1–80 characters');
  if (!input.components.length) throw new CommunityError('invalid', 'add at least one device');
  if (input.components.some((c) => !Number.isInteger(c.count) || c.count < 1 || c.count > 16)) throw new CommunityError('invalid', 'device count must be 1–16');
  const devices = await db
    .select({ id: s.hardwareDevice.id, memoryKind: s.hardwareDevice.memoryKind })
    .from(s.hardwareDevice)
    .where(inArray(s.hardwareDevice.id, input.components.map((c) => c.deviceId)));
  if (devices.length !== new Set(input.components.map((c) => c.deviceId)).size) throw new CommunityError('invalid', 'unknown device');
  const unified = devices.some((d) => d.memoryKind === 'unified');
  if (unified && !(input.unifiedMemoryGb && input.unifiedMemoryGb > 0)) throw new CommunityError('invalid', 'unified-memory systems need a memory size');
  if (!(input.systemRamGb >= 0 && input.systemRamGb <= 4096)) throw new CommunityError('invalid', 'system RAM out of range');

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.userHardwareConfig)
      .values({
        ownerProfileId: user.profileId, name, visibility: requireVisibility(input.visibility),
        systemRamGb: unified ? 0 : input.systemRamGb, systemRamBandwidthGbps: input.systemRamBandwidthGbps ?? null, unifiedMemoryGb: unified ? input.unifiedMemoryGb! : null,
      })
      .returning({ id: s.userHardwareConfig.id });
    await tx.insert(s.userHardwareConfigComponent).values(input.components.map((c) => ({ configId: row!.id, deviceId: c.deviceId, count: c.count })));
    return row!.id;
  });
}

export interface SubmissionInput {
  artifactId: string;
  benchmarkId: string;
  hardware: { configurationId: string } | { userConfigId: string };
  runtimeId: string;
  runtimeVersion?: string | null;
  backend: string;
  contextLength?: number | null;
  batchSize?: number | null;
  gpuLayers?: number | null;
  kvCacheType?: string | null;
  flashAttention?: boolean | null;
  os?: string | null;
  driverVersion?: string | null;
  notes?: string | null;
  visibility: string;
  measurements: { metricId: string; value: number }[];
}

export async function createBenchmarkSubmission(db: Database, viewer: Viewer, input: SubmissionInput): Promise<string> {
  const user = requireUser(viewer);
  const visibility = requireVisibility(input.visibility);

  const [artifact] = await db.select({ format: s.modelArtifact.format }).from(s.modelArtifact).where(eq(s.modelArtifact.id, input.artifactId));
  if (!artifact) throw new CommunityError('not_found', 'artifact not found');
  const [runtime] = await db.select().from(s.runtime).where(eq(s.runtime.projectId, input.runtimeId));
  if (!runtime) throw new CommunityError('not_found', 'runtime not found');
  if (!runtime.formats.includes(artifact.format)) throw new CommunityError('invalid', `runtime does not load ${artifact.format} weights`);
  if (!runtime.backends.includes(input.backend as ComputeBackend)) throw new CommunityError('invalid', `runtime does not support backend ${input.backend}`);

  let deviceBackends: string[];
  if ('userConfigId' in input.hardware) {
    const [cfg] = await db.select({ owner: s.userHardwareConfig.ownerProfileId }).from(s.userHardwareConfig).where(eq(s.userHardwareConfig.id, input.hardware.userConfigId));
    // A submission may only reference the submitter's own configuration.
    if (!cfg || cfg.owner !== user.profileId) throw new CommunityError('forbidden', 'you can only submit results for your own hardware configurations');
    deviceBackends = (await db.select({ backends: s.hardwareDevice.backends }).from(s.userHardwareConfigComponent)
      .innerJoin(s.hardwareDevice, eq(s.hardwareDevice.id, s.userHardwareConfigComponent.deviceId))
      .where(eq(s.userHardwareConfigComponent.configId, input.hardware.userConfigId))).flatMap((r) => r.backends);
  } else {
    deviceBackends = (await db.select({ backends: s.hardwareDevice.backends }).from(s.hardwareConfigurationComponent)
      .innerJoin(s.hardwareDevice, eq(s.hardwareDevice.id, s.hardwareConfigurationComponent.deviceId))
      .where(eq(s.hardwareConfigurationComponent.configurationId, input.hardware.configurationId))).flatMap((r) => r.backends);
    if (!deviceBackends.length) throw new CommunityError('not_found', 'hardware configuration not found');
  }
  if (input.backend !== 'cpu' && !deviceBackends.includes(input.backend)) throw new CommunityError('invalid', `backend ${input.backend} is not available on that hardware`);

  const metrics = await db.select({ id: s.benchmarkMetric.id }).from(s.benchmarkMetric).where(eq(s.benchmarkMetric.benchmarkId, input.benchmarkId));
  const allowed = new Set(metrics.map((m) => m.id));
  const measurements = input.measurements.filter((m) => Number.isFinite(m.value));
  if (!measurements.length) throw new CommunityError('invalid', 'at least one measurement is required');
  if (measurements.some((m) => !allowed.has(m.metricId))) throw new CommunityError('invalid', 'measurement does not belong to the benchmark');
  if (measurements.some((m) => m.value <= 0 || m.value > 1e7)) throw new CommunityError('invalid', 'measurement values must be positive');
  const positiveInt = (n: number | null | undefined, max: number) => (n == null ? null : Number.isInteger(n) && n >= 0 && n <= max ? n : (() => { throw new CommunityError('invalid', 'invalid numeric environment field'); })());

  return db.transaction(async (tx) => {
    const [env] = await tx
      .insert(s.runEnvironment)
      .values({
        hardwareConfigurationId: 'configurationId' in input.hardware ? input.hardware.configurationId : null,
        userHardwareConfigId: 'userConfigId' in input.hardware ? input.hardware.userConfigId : null,
        runtimeId: input.runtimeId, runtimeVersion: input.runtimeVersion?.slice(0, 60) || null, backend: input.backend as ComputeBackend,
        contextLength: positiveInt(input.contextLength, 10_000_000), batchSize: positiveInt(input.batchSize, 100_000), gpuLayers: positiveInt(input.gpuLayers, 1000),
        kvCacheType: input.kvCacheType?.slice(0, 20) || null, flashAttention: input.flashAttention ?? null, os: input.os?.slice(0, 60) || null, driverVersion: input.driverVersion?.slice(0, 60) || null,
      })
      .returning({ id: s.runEnvironment.id });
    const [sub] = await tx
      .insert(s.benchmarkSubmission)
      .values({ submitterProfileId: user.profileId, artifactId: input.artifactId, benchmarkId: input.benchmarkId, environmentId: env!.id, notes: input.notes?.trim().slice(0, 2000) || null, visibility })
      .returning({ id: s.benchmarkSubmission.id });
    await tx.insert(s.submissionMeasurement).values(measurements.map((m) => ({ submissionId: sub!.id, metricId: m.metricId, value: m.value })));
    await enqueueJob(tx, { kind: 'compat.invalidate', payload: { artifactId: input.artifactId }, dedupeKey: `compat.invalidate:${input.artifactId}` });
    return sub!.id;
  });
}

/** Governed resource visibility check for vote targets, using the same SQL filter as listings (direct access). */
async function targetVisible(db: Executor, viewer: Viewer, target: { reviewId: string } | { submissionId: string }) {
  const { visibleTo } = await import('../visibility');
  if ('reviewId' in target) {
    const [r] = await db.select({ owner: s.review.authorProfileId }).from(s.review)
      .where(and(eq(s.review.id, target.reviewId), visibleTo(viewer, { visibility: s.review.visibility, status: s.review.status, owner: s.review.authorProfileId }, 'direct')));
    return r ?? null;
  }
  const [r] = await db.select({ owner: s.benchmarkSubmission.submitterProfileId }).from(s.benchmarkSubmission)
    .where(and(eq(s.benchmarkSubmission.id, target.submissionId), visibleTo(viewer, { visibility: s.benchmarkSubmission.visibility, status: s.benchmarkSubmission.status, owner: s.benchmarkSubmission.submitterProfileId }, 'direct')));
  return r ?? null;
}

export async function castVote(db: Database, viewer: Viewer, target: { reviewId: string } | { submissionId: string }, value: 1 | -1 | 0): Promise<void> {
  const user = requireUser(viewer);
  const found = await targetVisible(db, viewer, target);
  if (!found) throw new CommunityError('not_found', 'not found');
  if (found.owner === user.profileId) throw new CommunityError('forbidden', 'you cannot vote on your own contribution');
  const match = 'reviewId' in target ? eq(s.vote.reviewId, target.reviewId) : eq(s.vote.submissionId, target.submissionId);
  await db.transaction(async (tx) => {
    await tx.delete(s.vote).where(and(eq(s.vote.voterProfileId, user.profileId), match));
    if (value !== 0) {
      await tx.insert(s.vote).values({
        voterProfileId: user.profileId,
        reviewId: 'reviewId' in target ? target.reviewId : null,
        submissionId: 'submissionId' in target ? target.submissionId : null,
        value,
      });
    }
  });
}

export async function setSubmissionVerification(db: Database, viewer: Viewer, submissionId: string, state: VerificationState): Promise<void> {
  if (!isModerator(viewer)) throw new CommunityError('forbidden', 'moderators only');
  if (!(VERIFICATION_STATES as readonly string[]).includes(state)) throw new CommunityError('invalid', 'invalid verification state');
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(s.benchmarkSubmission)
      .set({ verification: state })
      .where(and(eq(s.benchmarkSubmission.id, submissionId), sql`${s.benchmarkSubmission.visibility} <> 'private'`))
      .returning({ artifactId: s.benchmarkSubmission.artifactId });
    if (!row) throw new CommunityError('not_found', 'submission not found');
    await enqueueJob(tx, { kind: 'compat.invalidate', payload: { artifactId: row.artifactId }, dedupeKey: `compat.invalidate:${row.artifactId}` });
  });
}

export async function moderateReview(db: Database, viewer: Viewer, reviewId: string, status: ModerationStatus): Promise<void> {
  if (!isModerator(viewer)) throw new CommunityError('forbidden', 'moderators only');
  const [row] = await db
    .update(s.review)
    .set({ status })
    .where(and(eq(s.review.id, reviewId), sql`${s.review.visibility} <> 'private'`))
    .returning({ id: s.review.id });
  if (!row) throw new CommunityError('not_found', 'review not found');
}
