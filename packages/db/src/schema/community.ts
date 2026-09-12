/**
 * Community data: public personas and user-authored content with explicit visibility.
 */
import { RATING_DIMENSIONS, VERIFICATION_STATES } from '@mutinai/domain';
import { sql } from 'drizzle-orm';
import { check, doublePrecision, index, integer, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { community, moderationStatus, profile, userHardwareConfig, visibility } from './community-refs';
import { benchmark, benchmarkMetric, entity, hardwareConfiguration, hardwareDevice, modelArtifact, runEnvironment } from './ecosystem';

export { community, moderationStatus, profile, userHardwareConfig, visibility };

const tuple = <T extends string>(v: readonly T[]) => v as unknown as [T, ...T[]];

export const verificationState = community.enum('verification_state', tuple(VERIFICATION_STATES));
export const ratingDimension = community.enum('rating_dimension', tuple(RATING_DIMENSIONS.map((d) => d.key)));

export const userHardwareConfigComponent = community.table(
  'user_hardware_config_component',
  {
    configId: uuid().notNull().references(() => userHardwareConfig.id, { onDelete: 'cascade' }),
    deviceId: uuid().notNull().references(() => hardwareDevice.id),
    count: integer().notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.configId, t.deviceId] }), check('user_component_count_positive', sql`${t.count} > 0`)],
);

export const review = community.table(
  'review',
  {
    id: uuid().primaryKey().defaultRandom(),
    authorProfileId: uuid().notNull().references(() => profile.id, { onDelete: 'cascade' }),
    entityId: uuid().notNull().references(() => entity.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    body: text().notNull(),
    /** Optional reference hardware the reviewer used. */
    hardwareConfigurationId: uuid().references(() => hardwareConfiguration.id),
    visibility: visibility().notNull().default('public'),
    status: moderationStatus().notNull().default('published'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('review_author_entity_key').on(t.authorProfileId, t.entityId),
    index('review_entity_idx').on(t.entityId),
  ],
);

export const reviewRating = community.table(
  'review_rating',
  {
    reviewId: uuid().notNull().references(() => review.id, { onDelete: 'cascade' }),
    dimension: ratingDimension().notNull(),
    score: smallint().notNull(),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.dimension] }), check('review_rating_range', sql`${t.score} between 1 and 5`)],
);

export const benchmarkSubmission = community.table(
  'benchmark_submission',
  {
    id: uuid().primaryKey().defaultRandom(),
    submitterProfileId: uuid().notNull().references(() => profile.id, { onDelete: 'cascade' }),
    artifactId: uuid().notNull().references(() => modelArtifact.id),
    benchmarkId: uuid().notNull().references(() => benchmark.id),
    environmentId: uuid().notNull().unique().references(() => runEnvironment.id),
    notes: text(),
    visibility: visibility().notNull().default('public'),
    status: moderationStatus().notNull().default('published'),
    verification: verificationState().notNull().default('unverified'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('submission_artifact_idx').on(t.artifactId), index('submission_submitter_idx').on(t.submitterProfileId)],
);

export const submissionMeasurement = community.table(
  'submission_measurement',
  {
    submissionId: uuid().notNull().references(() => benchmarkSubmission.id, { onDelete: 'cascade' }),
    metricId: uuid().notNull().references(() => benchmarkMetric.id),
    value: doublePrecision().notNull(),
  },
  (t) => [primaryKey({ columns: [t.submissionId, t.metricId] })],
);

export const vote = community.table(
  'vote',
  {
    id: uuid().primaryKey().defaultRandom(),
    voterProfileId: uuid().notNull().references(() => profile.id, { onDelete: 'cascade' }),
    reviewId: uuid().references(() => review.id, { onDelete: 'cascade' }),
    submissionId: uuid().references(() => benchmarkSubmission.id, { onDelete: 'cascade' }),
    value: smallint().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('vote_one_target', sql`num_nonnulls(${t.reviewId}, ${t.submissionId}) = 1`),
    check('vote_value', sql`${t.value} in (-1, 1)`),
    uniqueIndex('vote_voter_review_key').on(t.voterProfileId, t.reviewId),
    uniqueIndex('vote_voter_submission_key').on(t.voterProfileId, t.submissionId),
  ],
);
