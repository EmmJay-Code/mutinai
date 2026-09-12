/**
 * PRIVATE account data. Never selected by public queries. See docs/adr/0004-privacy-architecture.md.
 */
import { ROLES } from '@mutinai/domain';
import { boolean, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const identity = pgSchema('identity');

export const role = identity.enum('role', ROLES as unknown as [string, ...string[]]);

export const account = identity.table(
  'account',
  {
    id: uuid().primaryKey().defaultRandom(),
    authProvider: text().notNull(),
    authSubject: text().notNull(),
    /** Optional: collected only if the auth method needs it. */
    email: text(),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('account_auth_key').on(t.authProvider, t.authSubject)],
);

export const session = identity.table('session', {
  id: uuid().primaryKey().defaultRandom(),
  accountId: uuid().notNull().references(() => account.id, { onDelete: 'cascade' }),
  /** HMAC-SHA256 of the opaque cookie token; the token itself is never stored. */
  tokenHash: text().notNull().unique(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
});

export const accountPreference = identity.table('account_preference', {
  accountId: uuid().primaryKey().references(() => account.id, { onDelete: 'cascade' }),
  /** Explicit opt-in. User content is not used for AI training unless this is true. */
  allowAiTrainingUse: boolean().notNull().default(false),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const accountRole = identity.table(
  'account_role',
  {
    accountId: uuid().notNull().references(() => account.id, { onDelete: 'cascade' }),
    role: role().notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.role] })],
);
