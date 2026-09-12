/**
 * Community tables referenced by the ecosystem schema (run_environment → user config),
 * split out to avoid an import cycle between ecosystem.ts and community.ts.
 */
import { MODERATION_STATUSES, VISIBILITIES } from '@mutinai/domain';
import { pgSchema, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { account } from './identity';

export const community = pgSchema('community');

const tuple = <T extends string>(v: readonly T[]) => v as unknown as [T, ...T[]];
export const visibility = community.enum('visibility', tuple(VISIBILITIES));
export const moderationStatus = community.enum('moderation_status', tuple(MODERATION_STATUSES));

/** Public persona. `accountId` links to private identity data and must never be exposed. */
export const profile = community.table(
  'profile',
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid().notNull().unique().references(() => account.id, { onDelete: 'cascade' }),
    handle: text().notNull(),
    displayName: text().notNull(),
    bio: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('profile_handle_key').on(sql`lower(${t.handle})`)],
);

/** A user's own hardware ("my rig"). Private by default. */
export const userHardwareConfig = community.table('user_hardware_config', {
  id: uuid().primaryKey().defaultRandom(),
  ownerProfileId: uuid().notNull().references(() => profile.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  systemRamGb: real().notNull().default(0),
  systemRamBandwidthGbps: real(),
  unifiedMemoryGb: real(),
  visibility: visibility().notNull().default('private'),
  status: moderationStatus().notNull().default('published'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
