/**
 * Community reads. Every query takes a Viewer and applies the visibility policy in SQL (see ../visibility.ts).
 * Only public persona fields (handle, display name) are ever joined from profiles.
 */
import { aggregateRatings, ANONYMOUS, type RatingAggregate, type Viewer } from '@mutinai/domain';
import { sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../client';
import { publicAggregateEligible, visibleTo } from '../visibility';

const rows = async <T>(db: Executor, query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];

const reviewCols = { visibility: sql`r.visibility`, status: sql`r.status`, owner: sql`r.author_profile_id` };
const submissionCols = { visibility: sql`sub.visibility`, status: sql`sub.status`, owner: sql`sub.submitter_profile_id` };
const memberConfigCols = { visibility: sql`ucv.visibility`, status: sql`ucv.status`, owner: sql`ucv.owner_profile_id` };

export interface AuthorDTO {
  handle: string;
  displayName: string;
}

export interface ReviewDTO {
  id: string;
  title: string;
  body: string;
  visibility: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  author: AuthorDTO;
  subject: { kind: string; slug: string; name: string; modelSlug: string | null };
  hardware: { slug: string; name: string } | null;
  ratings: { dimension: string; score: number }[];
  helpfulScore: number;
  isOwn: boolean;
}

function reviewQuery(viewer: Viewer, mode: 'direct' | 'listing', filter: SQL, limit: number): SQL {
  const viewerProfile = viewer.kind === 'user' ? viewer.profileId : null;
  return sql`
    select r.id, r.title, r.body, r.visibility, r.status, r.created_at as "createdAt", r.updated_at as "updatedAt",
      jsonb_build_object('handle', p.handle, 'displayName', p.display_name) as author,
      jsonb_build_object('kind', e.kind, 'slug', e.slug, 'name', e.name, 'modelSlug', coalesce(vm.slug, am.slug)) as subject,
      case when he.id is null then null else jsonb_build_object('slug', he.slug, 'name', he.name) end as hardware,
      coalesce((select jsonb_agg(jsonb_build_object('dimension', rr.dimension, 'score', rr.score) order by rr.dimension) from community.review_rating rr where rr.review_id = r.id), '[]') as ratings,
      coalesce((select sum(v.value)::int from community.vote v where v.review_id = r.id), 0) as "helpfulScore",
      ${viewerProfile ? sql`r.author_profile_id = ${viewerProfile}` : sql`false`} as "isOwn"
    from community.review r
    join community.profile p on p.id = r.author_profile_id
    join ecosystem.entity e on e.id = r.entity_id
    left join ecosystem.model_variant vv on vv.id = e.id left join ecosystem.entity vm on vm.id = vv.model_id
    left join ecosystem.model_artifact aa on aa.id = e.id left join ecosystem.model_variant av on av.id = aa.variant_id left join ecosystem.entity am on am.id = av.model_id
    left join ecosystem.entity he on he.id = r.hardware_configuration_id
    where ${visibleTo(viewer, reviewCols, mode)} and ${filter}
    order by "helpfulScore" desc, r.created_at desc
    limit ${limit}`;
}

export async function listReviewsForEntities(db: Executor, entityIds: string[], viewer: Viewer = ANONYMOUS, limit = 50): Promise<ReviewDTO[]> {
  if (!entityIds.length) return [];
  return rows<ReviewDTO>(db, reviewQuery(viewer, 'listing', sql`r.entity_id in (${sql.join(entityIds.map((id) => sql`${id}`), sql`, `)})`, limit));
}

export async function listRecentReviews(db: Executor, viewer: Viewer = ANONYMOUS, limit = 10): Promise<ReviewDTO[]> {
  return rows<ReviewDTO>(db, sql`select * from (${reviewQuery(viewer, 'listing', sql`true`, 500)}) x order by "createdAt" desc limit ${limit}`);
}

export async function getReview(db: Executor, id: string, viewer: Viewer = ANONYMOUS): Promise<ReviewDTO | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await rows<ReviewDTO>(db, reviewQuery(viewer, 'direct', sql`r.id = ${id}`, 1)))[0] ?? null;
}

/** Public aggregates: only public + published reviews count, regardless of viewer. */
export async function ratingAggregates(db: Executor, entityIds: string[]): Promise<RatingAggregate[]> {
  if (!entityIds.length) return [];
  const ratings = await rows<{ dimension: string; score: number }>(db, sql`
    select rr.dimension::text as dimension, rr.score from community.review_rating rr
    join community.review r on r.id = rr.review_id
    where r.entity_id in (${sql.join(entityIds.map((id) => sql`${id}`), sql`, `)}) and ${publicAggregateEligible(reviewCols)}`);
  return aggregateRatings(ratings);
}

export interface SubmissionDTO {
  id: string;
  createdAt: Date;
  visibility: string;
  status: string;
  verification: string;
  notes: string | null;
  submitter: AuthorDTO;
  artifact: { slug: string; name: string; schemeName: string; modelSlug: string; variantName: string };
  benchmark: { slug: string; name: string };
  runtime: { slug: string; name: string };
  environment: {
    runtimeVersion: string | null;
    backend: string;
    contextLength: number | null;
    batchSize: number | null;
    gpuLayers: number | null;
    kvCacheType: string | null;
    flashAttention: boolean | null;
    os: string | null;
    driverVersion: string | null;
    parameters: Record<string, string | number | boolean>;
  };
  /**
   * Reference configurations are named. For a member's own configuration, the hardware components are disclosed as
   * part of the submission, but the configuration's name is only shown to viewers allowed to see that configuration.
   */
  hardware:
    | { type: 'reference'; slug: string; name: string }
    | { type: 'member'; name: string | null; components: { slug: string; name: string; count: number }[]; systemRamGb: number; unifiedMemoryGb: number | null };
  measurements: { key: string; label: string; unit: string; higherIsBetter: boolean; value: number }[];
  helpfulScore: number;
  isOwn: boolean;
}

export interface SubmissionFilter {
  artifactIds?: string[];
  modelId?: string;
  deviceId?: string;
  configurationId?: string;
  submitterHandle?: string;
  id?: string;
}

function submissionQuery(viewer: Viewer, mode: 'direct' | 'listing', f: SubmissionFilter, limit: number): SQL {
  const where: SQL[] = [visibleTo(viewer, submissionCols, mode)];
  if (f.id) where.push(sql`sub.id = ${f.id}`);
  if (f.artifactIds?.length) where.push(sql`sub.artifact_id in (${sql.join(f.artifactIds.map((x) => sql`${x}`), sql`, `)})`);
  if (f.modelId) where.push(sql`v.model_id = ${f.modelId}`);
  if (f.configurationId) where.push(sql`env.hardware_configuration_id = ${f.configurationId}`);
  if (f.submitterHandle) where.push(sql`lower(p.handle) = lower(${f.submitterHandle})`);
  if (f.deviceId) {
    where.push(sql`(exists (select 1 from ecosystem.hardware_configuration_component c where c.configuration_id = env.hardware_configuration_id and c.device_id = ${f.deviceId})
      or exists (select 1 from community.user_hardware_config_component c where c.config_id = env.user_hardware_config_id and c.device_id = ${f.deviceId}))`);
  }
  const viewerProfile = viewer.kind === 'user' ? viewer.profileId : null;
  const configVisible = visibleTo(viewer, memberConfigCols, 'direct');

  return sql`
    select sub.id, sub.created_at as "createdAt", sub.visibility, sub.status, sub.verification, sub.notes,
      jsonb_build_object('handle', p.handle, 'displayName', p.display_name) as submitter,
      jsonb_build_object('slug', ae.slug, 'name', ae.name, 'schemeName', se.name, 'modelSlug', me.slug, 'variantName', ve.name) as artifact,
      jsonb_build_object('slug', be.slug, 'name', be.name) as benchmark,
      jsonb_build_object('slug', rte.slug, 'name', rte.name) as runtime,
      jsonb_build_object('runtimeVersion', env.runtime_version, 'backend', env.backend, 'contextLength', env.context_length, 'batchSize', env.batch_size,
        'gpuLayers', env.gpu_layers, 'kvCacheType', env.kv_cache_type, 'flashAttention', env.flash_attention, 'os', env.os,
        'driverVersion', env.driver_version, 'parameters', env.parameters) as environment,
      case when env.hardware_configuration_id is not null then
        jsonb_build_object('type', 'reference', 'slug', ce.slug, 'name', ce.name)
      else
        jsonb_build_object('type', 'member',
          'name', (select ucv.name from community.user_hardware_config ucv where ucv.id = env.user_hardware_config_id and ${configVisible}),
          'systemRamGb', uc.system_ram_gb, 'unifiedMemoryGb', uc.unified_memory_gb,
          'components', (select jsonb_agg(jsonb_build_object('slug', de.slug, 'name', de.name, 'count', c.count) order by de.name)
            from community.user_hardware_config_component c join ecosystem.entity de on de.id = c.device_id where c.config_id = env.user_hardware_config_id))
      end as hardware,
      (select jsonb_agg(jsonb_build_object('key', bm.key, 'label', bm.label, 'unit', bm.unit, 'higherIsBetter', bm.higher_is_better, 'value', sm.value) order by bm.key)
        from community.submission_measurement sm join ecosystem.benchmark_metric bm on bm.id = sm.metric_id where sm.submission_id = sub.id) as measurements,
      coalesce((select sum(vt.value)::int from community.vote vt where vt.submission_id = sub.id), 0) as "helpfulScore",
      ${viewerProfile ? sql`sub.submitter_profile_id = ${viewerProfile}` : sql`false`} as "isOwn"
    from community.benchmark_submission sub
    join community.profile p on p.id = sub.submitter_profile_id
    join ecosystem.run_environment env on env.id = sub.environment_id
    left join ecosystem.entity ce on ce.id = env.hardware_configuration_id
    left join community.user_hardware_config uc on uc.id = env.user_hardware_config_id
    join ecosystem.model_artifact a on a.id = sub.artifact_id
    join ecosystem.entity ae on ae.id = a.id
    join ecosystem.entity se on se.id = a.scheme_id
    join ecosystem.model_variant v on v.id = a.variant_id
    join ecosystem.entity ve on ve.id = v.id
    join ecosystem.entity me on me.id = v.model_id
    join ecosystem.entity be on be.id = sub.benchmark_id
    join ecosystem.entity rte on rte.id = env.runtime_id
    where ${sql.join(where, sql` and `)}
    order by sub.created_at desc
    limit ${limit}`;
}

export async function listSubmissions(db: Executor, f: SubmissionFilter, viewer: Viewer = ANONYMOUS, limit = 50): Promise<SubmissionDTO[]> {
  return rows<SubmissionDTO>(db, submissionQuery(viewer, 'listing', f, limit));
}

export async function getSubmission(db: Executor, id: string, viewer: Viewer = ANONYMOUS): Promise<SubmissionDTO | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await rows<SubmissionDTO>(db, submissionQuery(viewer, 'direct', { id }, 1)))[0] ?? null;
}

export interface PublicProfileDTO {
  handle: string;
  displayName: string;
  bio: string | null;
  createdAt: Date;
  reviewCount: number;
  submissionCount: number;
}

export async function getPublicProfile(db: Executor, handle: string): Promise<PublicProfileDTO | null> {
  const [row] = await rows<PublicProfileDTO>(db, sql`
    select p.handle, p.display_name as "displayName", p.bio, p.created_at as "createdAt",
      (select count(*)::int from community.review r where r.author_profile_id = p.id and ${publicAggregateEligible(reviewCols)}) as "reviewCount",
      (select count(*)::int from community.benchmark_submission sub where sub.submitter_profile_id = p.id and ${publicAggregateEligible(submissionCols)}) as "submissionCount"
    from community.profile p where lower(p.handle) = lower(${handle})`);
  return row ?? null;
}

export async function listReviewsByAuthor(db: Executor, handle: string, viewer: Viewer = ANONYMOUS, limit = 50): Promise<ReviewDTO[]> {
  return rows<ReviewDTO>(db, reviewQuery(viewer, 'listing', sql`lower(p.handle) = lower(${handle})`, limit));
}

export interface OwnHardwareConfigDTO {
  id: string;
  name: string;
  visibility: string;
  systemRamGb: number;
  unifiedMemoryGb: number | null;
  components: { slug: string; name: string; count: number }[];
}

export async function listOwnHardwareConfigs(db: Executor, viewer: Viewer): Promise<OwnHardwareConfigDTO[]> {
  if (viewer.kind !== 'user') return [];
  return rows<OwnHardwareConfigDTO>(db, sql`
    select u.id, u.name, u.visibility, u.system_ram_gb as "systemRamGb", u.unified_memory_gb as "unifiedMemoryGb",
      coalesce((select jsonb_agg(jsonb_build_object('slug', de.slug, 'name', de.name, 'count', c.count) order by de.name)
        from community.user_hardware_config_component c join ecosystem.entity de on de.id = c.device_id where c.config_id = u.id), '[]') as components
    from community.user_hardware_config u where u.owner_profile_id = ${viewer.profileId} order by u.created_at`);
}

export async function getCommunityStats(db: Executor) {
  const [row] = await rows<{ profiles: number; reviews: number; submissions: number; verified: number }>(db, sql`
    select (select count(*)::int from community.profile) as profiles,
      (select count(*)::int from community.review r where ${publicAggregateEligible(reviewCols)}) as reviews,
      (select count(*)::int from community.benchmark_submission sub where ${publicAggregateEligible(submissionCols)}) as submissions,
      (select count(*)::int from community.benchmark_submission sub where ${publicAggregateEligible(submissionCols)} and sub.verification = 'verified') as verified`);
  return row!;
}
