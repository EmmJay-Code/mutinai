/**
 * Public ecosystem data. See docs/adr/0002-ontology.md.
 */
import {
  ARCHITECTURES,
  BENCHMARK_KINDS,
  CAPABILITIES,
  COMPUTE_BACKENDS,
  DEVICE_KINDS,
  ENTITY_KINDS,
  EVENT_ENTITY_ROLES,
  EVENT_KINDS,
  MEMORY_KINDS,
  ORGANIZATION_KINDS,
  PROJECT_CATEGORIES,
  QUANTIZATION_METHODS,
  RELATION_PREDICATES,
  VARIANT_KINDS,
  WEIGHT_FORMATS,
} from '@mutinai/domain';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { source, sourceRecord } from './ingest';
import { userHardwareConfig } from './community-refs';

export const ecosystem = pgSchema('ecosystem');

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
const asTuple = <T extends string>(values: readonly T[]) => values as unknown as [T, ...T[]];

export const entityKind = ecosystem.enum('entity_kind', asTuple(ENTITY_KINDS));
export const organizationKind = ecosystem.enum('organization_kind', asTuple(ORGANIZATION_KINDS));
export const variantKind = ecosystem.enum('variant_kind', asTuple(VARIANT_KINDS));
export const capability = ecosystem.enum('capability', asTuple(CAPABILITIES));
export const architecture = ecosystem.enum('architecture', asTuple(ARCHITECTURES));
export const weightFormat = ecosystem.enum('weight_format', asTuple(WEIGHT_FORMATS));
export const quantizationMethod = ecosystem.enum('quantization_method', asTuple(QUANTIZATION_METHODS));
export const computeBackend = ecosystem.enum('compute_backend', asTuple(COMPUTE_BACKENDS));
export const deviceKind = ecosystem.enum('device_kind', asTuple(DEVICE_KINDS));
export const memoryKind = ecosystem.enum('memory_kind', asTuple(MEMORY_KINDS));
export const projectCategory = ecosystem.enum('project_category', asTuple(PROJECT_CATEGORIES));
export const benchmarkKind = ecosystem.enum('benchmark_kind', asTuple(BENCHMARK_KINDS));
export const eventKind = ecosystem.enum('event_kind', asTuple(EVENT_KINDS));
export const eventEntityRole = ecosystem.enum('event_entity_role', asTuple(EVENT_ENTITY_ROLES));
export const relationPredicate = ecosystem.enum('relation_predicate', asTuple(RELATION_PREDICATES));
export const commercialUse = ecosystem.enum('commercial_use', ['allowed', 'restricted', 'prohibited']);
/**
 * Who produced a benchmark result. `benchmark_operator` is the benchmark's own maintainers running every subject
 * themselves (LiveBench, BFCL, Aider's polyglot leaderboard); `submitted_registry` is a benchmark that publishes
 * numbers other people produced and submitted (SWE-bench). The two are not interchangeable, so they are separate
 * values rather than a single "the benchmark said so".
 */
export const resultOrigin = ecosystem.enum('result_origin', [
  'benchmark_operator',
  'third_party',
  'submitted_registry',
  'developer_reported',
  'editorial',
]);

/** What the source's terms let us do with its results. Ingestion is refused unless this has been checked. */
export const redistributionPermission = ecosystem.enum('redistribution_permission', [
  'permitted',
  'attribution_required',
  'unverified',
  'prohibited',
]);

/** How the subject was addressed: the shape of the request, not a property of the model. */
export const evaluationPromptMode = ecosystem.enum('evaluation_prompt_mode', ['unspecified', 'prompt', 'function_calling', 'agentic']);

/** How a benchmark's headline number is computed from its stored subtask facts. Never ingested as a fact itself. */
export const rollupMethod = ecosystem.enum('rollup_method', ['none', 'mean_of_subtasks', 'weighted_subtasks', 'pooled_samples']);

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

/** Supertype row for every ecosystem entity (class-table inheritance). */
export const entity = ecosystem.table(
  'entity',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: entityKind().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
    summary: text(),
    /** Name + aliases + key facts, maintained by the search.reindex_entity job. */
    searchText: text().notNull().default(''),
    searchVector: tsvector().generatedAlwaysAs(
      (): SQL => sql`setweight(to_tsvector('simple', ${entity.name}), 'A') || setweight(to_tsvector('simple', ${entity.searchText}), 'B') || setweight(to_tsvector('english', coalesce(${entity.summary}, '')), 'C')`,
    ),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('entity_kind_slug_key').on(t.kind, t.slug),
    index('entity_search_vector_idx').using('gin', t.searchVector),
    index('entity_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
  ],
);

const entityPk = () => uuid().primaryKey().references(() => entity.id, { onDelete: 'cascade' });

export const entityAlias = ecosystem.table(
  'entity_alias',
  {
    entityId: uuid().notNull().references(() => entity.id, { onDelete: 'cascade' }),
    alias: text().notNull(),
    /** lowercased, punctuation-stripped form used for identity resolution. */
    normalized: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.normalized] }), index('entity_alias_normalized_idx').on(t.normalized)],
);

export const license = ecosystem.table('license', {
  id: uuid().primaryKey().defaultRandom(),
  key: text().notNull().unique(),
  name: text().notNull(),
  spdxId: text(),
  osiApproved: boolean().notNull().default(false),
  commercialUse: commercialUse().notNull(),
  url: text(),
});

export const organization = ecosystem.table('organization', {
  id: entityPk(),
  orgKind: organizationKind().notNull(),
  /**
   * A recognized ecosystem organization (editorial: model developers, hardware vendors, project maintainers). Publisher
   * accounts that ingestion records for provenance, such as the Hugging Face account behind a community fine-tune, are
   * not, and stay off public organization surfaces. See docs/adr/0009-freshness-and-publisher-accounts.md.
   */
  recognized: boolean().notNull().default(false),
  websiteUrl: text(),
  country: text(),
});

export const modelFamily = ecosystem.table('model_family', {
  id: entityPk(),
  developerOrgId: uuid().notNull().references(() => organization.id),
  parentFamilyId: uuid().references((): AnyPgColumn => modelFamily.id),
});

export const modelRelease = ecosystem.table(
  'model_release',
  {
    id: entityPk(),
    familyId: uuid().notNull().references(() => modelFamily.id),
    releasedOn: date(),
    defaultLicenseId: uuid().references(() => license.id),
    announcementUrl: text(),
  },
  (t) => [index('model_release_family_idx').on(t.familyId)],
);

export const model = ecosystem.table(
  'model',
  {
    id: entityPk(),
    releaseId: uuid().notNull().references(() => modelRelease.id),
    architecture: architecture().notNull(),
    paramsTotal: bigint({ mode: 'number' }).notNull(),
    /** Active parameters per token for MoE; null for dense. */
    paramsActive: bigint({ mode: 'number' }),
    layers: integer().notNull(),
    attentionHeads: integer().notNull(),
    kvHeads: integer().notNull(),
    headDim: integer().notNull(),
    kvBytesPerTokenOverride: integer(),
    contextLength: integer().notNull(),
  },
  (t) => [
    index('model_release_idx').on(t.releaseId),
    check('model_moe_active_params', sql`(${t.architecture} = 'moe') = (${t.paramsActive} is not null)`),
    check('model_positive_dims', sql`${t.paramsTotal} > 0 and ${t.layers} > 0 and ${t.kvHeads} > 0 and ${t.headDim} > 0 and ${t.contextLength} > 0`),
  ],
);

export const modelVariant = ecosystem.table(
  'model_variant',
  {
    id: entityPk(),
    modelId: uuid().notNull().references(() => model.id),
    variantKind: variantKind().notNull(),
    publisherOrgId: uuid().notNull().references(() => organization.id),
    licenseId: uuid().references(() => license.id),
    capabilities: capability().array().notNull().default(sql`'{}'`),
    releasedOn: date(),
  },
  (t) => [index('model_variant_model_idx').on(t.modelId)],
);

export const quantizationScheme = ecosystem.table('quantization_scheme', {
  id: entityPk(),
  method: quantizationMethod().notNull(),
  format: weightFormat().notNull(),
  bitsPerWeight: real().notNull(),
});

export const modelArtifact = ecosystem.table(
  'model_artifact',
  {
    id: entityPk(),
    variantId: uuid().notNull().references(() => modelVariant.id),
    schemeId: uuid().notNull().references(() => quantizationScheme.id),
    publisherOrgId: uuid().notNull().references(() => organization.id),
    format: weightFormat().notNull(),
    sizeBytes: bigint({ mode: 'number' }),
    /** e.g. a Hugging Face repo id. Identity mapping lives in ingest.external_identifier. */
    sourceRepo: text(),
  },
  (t) => [
    uniqueIndex('model_artifact_variant_scheme_publisher_key').on(t.variantId, t.schemeId, t.publisherOrgId),
    index('model_artifact_variant_idx').on(t.variantId),
  ],
);

export const hardwareDevice = ecosystem.table(
  'hardware_device',
  {
    id: entityPk(),
    vendorOrgId: uuid().notNull().references(() => organization.id),
    deviceKind: deviceKind().notNull(),
    memoryKind: memoryKind().notNull(),
    memoryGb: real(),
    memoryType: text(),
    memoryBandwidthGbps: real(),
    unifiedUsableFraction: real(),
    backends: computeBackend().array().notNull(),
    tdpWatts: integer(),
    releasedOn: date(),
    launchPriceUsd: integer(),
    /** Product image for presentation. Must be properly sourced; credit it when set. */
    imageUrl: text(),
    imageCredit: text(),
  },
  (t) => [check('hardware_device_dedicated_memory', sql`(${t.memoryKind} = 'dedicated') = (${t.memoryGb} is not null)`)],
);

/** Reference (editorial/public) configurations. User-owned configurations live in community.user_hardware_config. */
export const hardwareConfiguration = ecosystem.table('hardware_configuration', {
  id: entityPk(),
  formFactor: text().notNull(),
  systemRamGb: real().notNull().default(0),
  systemRamBandwidthGbps: real(),
  unifiedMemoryGb: real(),
  approxPriceUsd: integer(),
  /** Product image for presentation. Must be properly sourced; credit it when set. */
  imageUrl: text(),
  imageCredit: text(),
});

export const hardwareConfigurationComponent = ecosystem.table(
  'hardware_configuration_component',
  {
    configurationId: uuid().notNull().references(() => hardwareConfiguration.id, { onDelete: 'cascade' }),
    deviceId: uuid().notNull().references(() => hardwareDevice.id),
    count: integer().notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.configurationId, t.deviceId] }), check('component_count_positive', sql`${t.count} > 0`)],
);

export const project = ecosystem.table('project', {
  id: entityPk(),
  category: projectCategory().notNull(),
  maintainerOrgId: uuid().references(() => organization.id),
  licenseId: uuid().references(() => license.id),
  repoUrl: text(),
  homepageUrl: text(),
  primaryLanguage: text(),
});

/** Inference engine: 1:1 extension of project. */
export const runtime = ecosystem.table('runtime', {
  projectId: uuid().primaryKey().references(() => project.id, { onDelete: 'cascade' }),
  formats: weightFormat().array().notNull(),
  backends: computeBackend().array().notNull(),
  supportsOffload: boolean().notNull(),
  supportsMultiGpu: boolean().notNull(),
  openaiCompatibleApi: boolean().notNull().default(false),
});

/**
 * Where canonical results come from, and what the source's terms let us do with them.
 *
 * A source is only ingestible once someone has read its licence and recorded what it grants: `ingestion_enabled`
 * cannot be turned on while `redistribution` is `unverified` or `prohibited`, and `benchmark_run` carries a foreign
 * key that makes the database refuse runs from a source that is not enabled. Permission is therefore a fact the
 * schema enforces, not a convention an adapter is trusted to follow.
 */
export const resultSource = ecosystem.table(
  'result_source',
  {
    id: uuid().primaryKey().defaultRandom(),
    key: text().notNull().unique(),
    name: text().notNull(),
    /** The organization that publishes the results, when it is a recognized ecosystem organization. */
    publisherOrgId: uuid().references(() => organization.id),
    homepageUrl: text(),
    /** The exact file or endpoint results are read from, not the project's front page. */
    datasetUrl: text(),
    licenseId: uuid().references(() => license.id),
    /** The licence text the grant was actually read from; null when no licence could be found. */
    licenseUrl: text(),
    redistribution: redistributionPermission().notNull().default('unverified'),
    /** The credit line to display wherever these results are shown. Required when attribution is the condition. */
    attribution: text(),
    /** What was checked, and what is still unresolved. Read this before enabling ingestion. */
    permissionNote: text(),
    permissionCheckedOn: date(),
    ingestionEnabled: boolean().notNull().default(false),
    /** Display precedence between sources that report the same measurement. Higher wins; never value-based. */
    priority: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('result_source_id_enabled_key').on(t.id, t.ingestionEnabled),
    check('result_source_permission_checked', sql`${t.ingestionEnabled} = false or ${t.redistribution} in ('permitted', 'attribution_required')`),
    check('result_source_attribution_present', sql`${t.redistribution} <> 'attribution_required' or ${t.attribution} is not null`),
  ],
);

export const benchmark = ecosystem.table('benchmark', {
  id: entityPk(),
  benchmarkKind: benchmarkKind().notNull(),
  homepageUrl: text(),
  methodology: text(),
  /** The metric a single headline number for this benchmark is read from. */
  headlineMetricId: uuid().references((): AnyPgColumn => benchmarkMetric.id),
  /**
   * The configuration a headline number is read under, when the benchmark publishes several (Aider reports one
   * and two attempts; BFCL reports function-calling and prompt modes). Read as a pattern rather than an exact
   * match: only the fields it sets have to agree, so it pins the dimension that decides which number the
   * leaderboard prints without pinning the rest of the harness. Null means no configuration is privileged.
   */
  headlineConfigId: uuid().references((): AnyPgColumn => evaluationConfig.id),
  rollupMethod: rollupMethod().notNull().default('none'),
});

export const benchmarkMetric = ecosystem.table(
  'benchmark_metric',
  {
    id: uuid().primaryKey().defaultRandom(),
    benchmarkId: uuid().notNull().references(() => benchmark.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    label: text().notNull(),
    unit: text().notNull(),
    higherIsBetter: boolean().notNull().default(true),
  },
  (t) => [
    uniqueIndex('benchmark_metric_key').on(t.benchmarkId, t.key),
    unique('benchmark_metric_id_benchmark_key').on(t.id, t.benchmarkId),
  ],
);

/**
 * The unit a benchmark actually measures: one LiveBench task, one BFCL test category, one SWE-bench repository.
 * Rows may nest one level (a category and the tasks under it) so a rollup can follow the benchmark's own structure.
 * Benchmarks that publish no breakdown (Aider's polyglot leaderboard) simply have no subtasks.
 */
export const benchmarkSubtask = ecosystem.table(
  'benchmark_subtask',
  {
    id: uuid().primaryKey().defaultRandom(),
    benchmarkId: uuid().notNull().references(() => benchmark.id, { onDelete: 'cascade' }),
    parentId: uuid().references((): AnyPgColumn => benchmarkSubtask.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    label: text().notNull(),
    /** Relative weight within its parent for `weighted_subtasks`; null means equal weight. */
    weight: real(),
    /**
     * How this node's value is computed from its children; null falls back to the benchmark's method. Sources do
     * mix methods within one benchmark — BFCL takes an unweighted mean over its non-live categories and a
     * sample-weighted one over its live categories — and a rollup that ignores that is not the benchmark's number.
     */
    rollupMethod: rollupMethod(),
    position: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex('benchmark_subtask_key').on(t.benchmarkId, t.key),
    unique('benchmark_subtask_id_benchmark_key').on(t.id, t.benchmarkId),
    index('benchmark_subtask_parent_idx').on(t.parentId),
    check('benchmark_subtask_not_self', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
    check('benchmark_subtask_weight_positive', sql`${t.weight} is null or ${t.weight} > 0`),
  ],
);

/**
 * How a subject was run, kept apart from what was run. Thinking effort, prompt mode and function-calling
 * configuration belong here: a leaderboard entry called `…-thinking-64k-high-effort` or `Qwen3-0.6B (FC)` is one
 * model under one configuration, and must never become a second model variant.
 *
 * The named columns are the knobs that mean the same thing across sources; `harness_config` holds the rest in
 * structured form (Aider's `edit_format`, …) and takes part in the uniqueness key, so two genuinely different
 * configurations can never collapse into one row.
 */
export const evaluationConfig = ecosystem.table(
  'evaluation_config',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Display only, derived from the fields below. Never parsed. */
    label: text(),
    promptMode: evaluationPromptMode().notNull().default('unspecified'),
    shots: integer(),
    chainOfThought: boolean(),
    reasoningEnabled: boolean(),
    /** The source's own effort level (`high`, `medium`, …); vendors do not agree on a scale. */
    reasoningEffort: text(),
    thinkingTokenBudget: integer(),
    /** Tries the harness allows per case. Aider reports the same session at one attempt and at two. */
    attempts: integer(),
    harnessConfig: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('evaluation_config_key')
      .on(t.promptMode, t.shots, t.chainOfThought, t.reasoningEnabled, t.reasoningEffort, t.thinkingTokenBudget, t.attempts, t.harnessConfig)
      .nullsNotDistinct(),
    check('evaluation_config_shots_nonnegative', sql`${t.shots} is null or ${t.shots} >= 0`),
    check('evaluation_config_attempts_positive', sql`${t.attempts} is null or ${t.attempts} >= 1`),
    check('evaluation_config_thinking_budget_positive', sql`${t.thinkingTokenBudget} is null or ${t.thinkingTokenBudget} > 0`),
  ],
);

/**
 * One evaluation of one subject, under one configuration, from one source. Results hang off a run, so the subtask
 * scores that came out of a single evaluation stay together and two sources disagreeing about the same model are
 * two runs rather than one overwritten number.
 */
export const benchmarkRun = ecosystem.table(
  'benchmark_run',
  {
    id: uuid().primaryKey().defaultRandom(),
    benchmarkId: uuid().notNull().references(() => benchmark.id),
    variantId: uuid().references(() => modelVariant.id),
    artifactId: uuid().references(() => modelArtifact.id),
    configId: uuid().notNull().references(() => evaluationConfig.id),
    resultSourceId: uuid().notNull(),
    /**
     * Always true, and part of the foreign key into `result_source (id, ingestion_enabled)`. A run cannot be
     * inserted for a source whose permission has not been established, and such a source cannot later be disabled
     * while its runs exist.
     */
    sourceIngestionEnabled: boolean().notNull().default(true),
    origin: resultOrigin().notNull(),
    environmentId: uuid().references(() => runEnvironment.id),
    /** The question set this run was scored against: a LiveBench table date, `BFCL_v4`, a SWE-bench split. */
    benchmarkVersion: text(),
    harnessName: text(),
    harnessVersion: text(),
    harnessCommit: text(),
    measuredOn: date(),
    citationUrl: text(),
    /**
     * The average the leaderboard printed for this run. Kept for reconciliation against the rollup computed from
     * the stored subtask facts, and never displayed as a measurement.
     */
    reportedRollupValue: doublePrecision(),
    /** Source-specific provenance: rank, cost, latency, logos, harness counters. Never read as a canonical fact. */
    raw: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** `<source key>:<external id>`; makes re-ingesting the same leaderboard entry idempotent. */
    dedupeKey: text().unique(),
    sourceRecordId: uuid().references(() => sourceRecord.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.resultSourceId, t.sourceIngestionEnabled], foreignColumns: [resultSource.id, resultSource.ingestionEnabled], name: 'benchmark_run_source_enabled_fk' }),
    unique('benchmark_run_id_benchmark_key').on(t.id, t.benchmarkId),
    check('benchmark_run_one_subject', sql`num_nonnulls(${t.variantId}, ${t.artifactId}) = 1`),
    check('benchmark_run_source_enabled', sql`${t.sourceIngestionEnabled}`),
    index('benchmark_run_variant_idx').on(t.variantId),
    index('benchmark_run_artifact_idx').on(t.artifactId),
    index('benchmark_run_benchmark_idx').on(t.benchmarkId),
  ],
);

/** Everything needed to reproduce a measurement. Shared by canonical results and community submissions. */
export const runEnvironment = ecosystem.table(
  'run_environment',
  {
    id: uuid().primaryKey().defaultRandom(),
    hardwareConfigurationId: uuid().references(() => hardwareConfiguration.id),
    userHardwareConfigId: uuid().references((): AnyPgColumn => userHardwareConfig.id, { onDelete: 'cascade' }),
    runtimeId: uuid().notNull().references(() => runtime.projectId),
    runtimeVersion: text(),
    backend: computeBackend().notNull(),
    contextLength: integer(),
    promptTokens: integer(),
    generationTokens: integer(),
    batchSize: integer(),
    /** Layers placed on accelerators; null means all. */
    gpuLayers: integer(),
    kvCacheType: text(),
    flashAttention: boolean(),
    os: text(),
    driverVersion: text(),
    parameters: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('run_environment_one_hardware', sql`num_nonnulls(${t.hardwareConfigurationId}, ${t.userHardwareConfigId}) = 1`),
    index('run_environment_hw_idx').on(t.hardwareConfigurationId),
  ],
);

/**
 * One measured number from one run: a metric, optionally scoped to a subtask. Subtask rows are the canonical
 * stored facts; category and overall averages are computed from them (`benchmark_run_rollup`) rather than ingested,
 * because every source computes its own averages differently — BFCL, for one, mixes weighted and unweighted means.
 *
 * `sample_numerator` / `sample_count` record what the number is a fraction of, so 18/225 and 8.0% are the same
 * fact and a result over 30 cases is not silently compared with one over 500. Sources that publish no counts
 * (LiveBench) leave both null. Community submissions stay separate.
 */
export const benchmarkResult = ecosystem.table(
  'benchmark_result',
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid().notNull().references(() => benchmarkRun.id, { onDelete: 'cascade' }),
    /** Denormalized from the run so the metric and subtask can be constrained to the same benchmark. */
    benchmarkId: uuid().notNull().references(() => benchmark.id),
    metricId: uuid().notNull().references(() => benchmarkMetric.id),
    /** Null for a number that covers the whole benchmark. */
    subtaskId: uuid().references(() => benchmarkSubtask.id),
    value: doublePrecision().notNull(),
    /** Not necessarily an integer: a subtask score can itself be a mean over partially credited items. */
    sampleNumerator: doublePrecision(),
    sampleCount: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.runId, t.benchmarkId], foreignColumns: [benchmarkRun.id, benchmarkRun.benchmarkId], name: 'benchmark_result_run_benchmark_fk' }),
    foreignKey({ columns: [t.metricId, t.benchmarkId], foreignColumns: [benchmarkMetric.id, benchmarkMetric.benchmarkId], name: 'benchmark_result_metric_benchmark_fk' }),
    foreignKey({ columns: [t.subtaskId, t.benchmarkId], foreignColumns: [benchmarkSubtask.id, benchmarkSubtask.benchmarkId], name: 'benchmark_result_subtask_benchmark_fk' }),
    unique('benchmark_result_run_metric_subtask_key').on(t.runId, t.metricId, t.subtaskId).nullsNotDistinct(),
    index('benchmark_result_run_idx').on(t.runId),
    index('benchmark_result_metric_idx').on(t.metricId),
    check('benchmark_result_samples_paired', sql`(${t.sampleNumerator} is null) = (${t.sampleCount} is null)`),
    check('benchmark_result_samples_in_range', sql`${t.sampleCount} is null or (${t.sampleCount} > 0 and ${t.sampleNumerator} between 0 and ${t.sampleCount})`),
  ],
);

export const event = ecosystem.table(
  'event',
  {
    id: uuid().primaryKey().defaultRandom(),
    eventKind: eventKind().notNull(),
    title: text().notNull(),
    summary: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    url: text(),
    /** `<source key>:<external id>` for ingested events; guarantees idempotent event creation. */
    dedupeKey: text().unique(),
    sourceRecordId: uuid().references(() => sourceRecord.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('event_occurred_idx').on(t.occurredAt)],
);

export const eventEntity = ecosystem.table(
  'event_entity',
  {
    eventId: uuid().notNull().references(() => event.id, { onDelete: 'cascade' }),
    entityId: uuid().notNull().references(() => entity.id, { onDelete: 'cascade' }),
    role: eventEntityRole().notNull().default('subject'),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.entityId] }), index('event_entity_entity_idx').on(t.entityId)],
);

export const entityRelation = ecosystem.table(
  'entity_relation',
  {
    id: uuid().primaryKey().defaultRandom(),
    subjectId: uuid().notNull().references(() => entity.id, { onDelete: 'cascade' }),
    predicate: relationPredicate().notNull(),
    objectId: uuid().notNull().references(() => entity.id, { onDelete: 'cascade' }),
    sourceRecordId: uuid().references(() => sourceRecord.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('entity_relation_key').on(t.subjectId, t.predicate, t.objectId),
    index('entity_relation_object_idx').on(t.objectId),
    check('entity_relation_not_self', sql`${t.subjectId} <> ${t.objectId}`),
  ],
);

export const derivedReviewStatus = ecosystem.enum('derived_review_status', ['unreviewed', 'approved', 'rejected']);

/**
 * AI-generated or computed content about an entity or an event. Never canonical: it is stored apart from the facts it
 * describes, records exactly what produced it (task, prompt version, provider, model, input hash, source records),
 * and is shown only once approved and labelled. See docs/ai-enrichment.md.
 */
export const derivedContent = ecosystem.table(
  'derived_content',
  {
    id: uuid().primaryKey().defaultRandom(),
    entityId: uuid().references(() => entity.id, { onDelete: 'cascade' }),
    eventId: uuid().references(() => event.id, { onDelete: 'cascade' }),
    contentKind: text().notNull(),
    body: text().notNull(),
    /** Enrichment task id (e.g. `entity.plain_summary`). */
    generator: text().notNull(),
    /** Task prompt version. */
    generatorVersion: text().notNull(),
    provider: text().notNull().default(''),
    model: text().notNull().default(''),
    /** Hash of task, prompt version, provider and the exact input facts; unchanged inputs are not regenerated. */
    inputHash: text().notNull().default(''),
    inputSourceRecordIds: uuid().array().notNull().default(sql`'{}'`),
    reviewStatus: derivedReviewStatus().notNull().default('unreviewed'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('derived_content_entity_idx').on(t.entityId),
    index('derived_content_event_idx').on(t.eventId),
    check('derived_content_one_subject', sql`num_nonnulls(${t.entityId}, ${t.eventId}) = 1`),
  ],
);

export const priceKind = ecosystem.enum('price_kind', ['launch_msrp', 'retail_new', 'used', 'editorial_estimate']);

/**
 * A dated, sourced price for a hardware device or configuration. Market prices (new/used) are observations at a time
 * and place, never timeless facts; the legacy launch/approx price columns remain until the UI reads from here.
 */
export const priceObservation = ecosystem.table(
  'price_observation',
  {
    id: uuid().primaryKey().defaultRandom(),
    entityId: uuid().notNull().references(() => entity.id, { onDelete: 'cascade' }),
    priceKind: priceKind().notNull(),
    amount: doublePrecision().notNull(),
    /** ISO 4217 code. */
    currency: text().notNull(),
    /** ISO 3166-1 alpha-2 market, or null when not market-specific (e.g. a launch MSRP). */
    region: text(),
    observedAt: timestamp({ withTimezone: true }).notNull(),
    sourceName: text().notNull(),
    sourceUrl: text(),
    sourceRecordId: uuid().references(() => sourceRecord.id),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('price_observation_latest_idx').on(t.entityId, t.priceKind, t.observedAt),
    check('price_observation_amount_positive', sql`${t.amount} > 0`),
    check('price_observation_currency_code', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * Volatile counters a source reports about an entity (Hugging Face downloads/likes, GitHub stars/forks).
 * Kept out of source snapshots so they do not create a new snapshot on every fetch; one row per day.
 */
export const entityMetric = ecosystem.table(
  'entity_metric',
  {
    entityId: uuid().notNull().references(() => entity.id, { onDelete: 'cascade' }),
    metric: text().notNull(),
    sourceId: uuid().notNull().references((): AnyPgColumn => source.id),
    observedOn: date().notNull(),
    value: doublePrecision().notNull(),
    observedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.entityId, t.metric, t.sourceId, t.observedOn] }),
    index('entity_metric_latest_idx').on(t.entityId, t.metric, t.observedOn),
  ],
);
