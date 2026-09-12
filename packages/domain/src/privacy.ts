/**
 * Visibility and access policy for user-authored content.
 * See docs/adr/0004-privacy-architecture.md.
 *
 * The SQL filters in @mutinai/db mirror `canView`; both are tested against the same matrix.
 */

export const VISIBILITIES = ['public', 'unlisted', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const MODERATION_STATUSES = ['pending', 'published', 'rejected', 'removed'] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export const VERIFICATION_STATES = ['unverified', 'verified', 'disputed'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const ROLES = ['moderator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export type Viewer =
  | { kind: 'anonymous' }
  | { kind: 'user'; profileId: string; roles: readonly Role[] };

export const ANONYMOUS: Viewer = { kind: 'anonymous' };

export interface GovernedResource {
  visibility: Visibility;
  status: ModerationStatus;
  ownerProfileId: string | null;
}

/** `direct`: fetched by id/link. `listing`: appears in feeds, directories, search, aggregates. */
export type AccessMode = 'direct' | 'listing';

export function isOwner(viewer: Viewer, r: GovernedResource): boolean {
  return viewer.kind === 'user' && r.ownerProfileId != null && viewer.profileId === r.ownerProfileId;
}

export function isModerator(viewer: Viewer): boolean {
  return viewer.kind === 'user' && (viewer.roles.includes('moderator') || viewer.roles.includes('admin'));
}

export function canView(viewer: Viewer, r: GovernedResource, mode: AccessMode = 'direct'): boolean {
  const owner = isOwner(viewer, r);
  // Private content is owner-only, including for moderators: it is not published, so there is nothing to moderate.
  if (r.visibility === 'private') return owner;
  if (r.status !== 'published') return owner || isModerator(viewer);
  if (r.visibility === 'unlisted') return mode === 'direct' || owner;
  return true;
}

/** Content eligible to feed public aggregates (rating averages, measured speeds). */
export function countsTowardPublicAggregates(r: GovernedResource): boolean {
  return r.visibility === 'public' && r.status === 'published';
}

/**
 * Keys that must never appear in any public payload. Used as a defence-in-depth assertion
 * on public API responses and by tests that deep-scan public query output.
 */
export const PRIVATE_FIELD_KEYS = [
  'email',
  'emailVerifiedAt',
  'accountId',
  'account_id',
  'authSubject',
  'auth_subject',
  'tokenHash',
  'token_hash',
  'allowAiTrainingUse',
  'ownerAccountId',
] as const;

export function findPrivateKeys(value: unknown, path = '$', found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findPrivateKeys(v, `${path}[${i}]`, found));
  } else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      if ((PRIVATE_FIELD_KEYS as readonly string[]).includes(k)) found.push(`${path}.${k}`);
      findPrivateKeys(v, `${path}.${k}`, found);
    }
  }
  return found;
}

export function assertNoPrivateKeys(value: unknown): void {
  const found = findPrivateKeys(value);
  if (found.length) throw new Error(`private fields in public payload: ${found.join(', ')}`);
}
