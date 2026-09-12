import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS,
  canView,
  countsTowardPublicAggregates,
  findPrivateKeys,
  MODERATION_STATUSES,
  VISIBILITIES,
  type GovernedResource,
  type Viewer,
} from '../src/privacy';

const owner: Viewer = { kind: 'user', profileId: 'owner', roles: [] };
const other: Viewer = { kind: 'user', profileId: 'other', roles: [] };
const moderator: Viewer = { kind: 'user', profileId: 'mod', roles: ['moderator'] };

/**
 * Expected access matrix. Exported shape is mirrored by the SQL visibility filter tests in @mutinai/db.
 * [visibility, status, viewer, mode] -> visible
 */
function expected(v: GovernedResource['visibility'], s: GovernedResource['status'], who: string, mode: 'direct' | 'listing'): boolean {
  if (v === 'private') return who === 'owner';
  if (s !== 'published') return who === 'owner' || who === 'moderator';
  if (v === 'unlisted') return mode === 'direct' || who === 'owner';
  return true;
}

describe('canView matrix', () => {
  const viewers = { anonymous: ANONYMOUS, owner, other, moderator } as const;
  for (const visibility of VISIBILITIES) {
    for (const status of MODERATION_STATUSES) {
      for (const [who, viewer] of Object.entries(viewers)) {
        for (const mode of ['direct', 'listing'] as const) {
          it(`${visibility}/${status} ${who} ${mode}`, () => {
            const r: GovernedResource = { visibility, status, ownerProfileId: 'owner' };
            expect(canView(viewer, r, mode)).toBe(expected(visibility, status, who, mode));
          });
        }
      }
    }
  }

  it('moderators cannot read private content', () => {
    expect(canView(moderator, { visibility: 'private', status: 'published', ownerProfileId: 'owner' })).toBe(false);
  });

  it('ownerless resources are never owner-visible', () => {
    expect(canView(owner, { visibility: 'private', status: 'published', ownerProfileId: null })).toBe(false);
  });
});

describe('aggregates', () => {
  it('only public published content counts', () => {
    expect(countsTowardPublicAggregates({ visibility: 'public', status: 'published', ownerProfileId: 'x' })).toBe(true);
    expect(countsTowardPublicAggregates({ visibility: 'unlisted', status: 'published', ownerProfileId: 'x' })).toBe(false);
    expect(countsTowardPublicAggregates({ visibility: 'public', status: 'pending', ownerProfileId: 'x' })).toBe(false);
  });
});

describe('findPrivateKeys', () => {
  it('finds private keys at any depth', () => {
    const payload = { reviews: [{ author: { handle: 'a', email: 'a@example.com' } }], meta: { accountId: '1' } };
    expect(findPrivateKeys(payload)).toEqual(['$.reviews[0].author.email', '$.meta.accountId']);
  });
  it('passes clean payloads', () => {
    expect(findPrivateKeys({ handle: 'x', createdAt: new Date() })).toEqual([]);
  });
});
