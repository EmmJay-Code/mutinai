/**
 * SQL mirror of `canView` from @mutinai/domain (docs/adr/0004-privacy-architecture.md).
 * Tested against the same matrix as the domain policy (packages/db/test/visibility.test.ts).
 */
import { isModerator, type AccessMode, type Viewer } from '@mutinai/domain';
import { and, eq, inArray, ne, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/** Columns may be Drizzle columns or raw SQL references (e.g. sql`r.visibility` when the table is aliased). */
export interface GovernedColumns {
  visibility: SQLWrapper;
  status: SQLWrapper;
  owner: SQLWrapper;
}

export function visibleTo(viewer: Viewer, cols: GovernedColumns, mode: AccessMode = 'listing'): SQL {
  const published = and(
    eq(cols.status, 'published'),
    mode === 'listing' ? eq(cols.visibility, 'public') : inArray(cols.visibility, ['public', 'unlisted']),
  )!;
  if (viewer.kind === 'anonymous') return published;
  const clauses: SQL[] = [published, eq(cols.owner, viewer.profileId)];
  if (isModerator(viewer)) clauses.push(and(ne(cols.visibility, 'private'), ne(cols.status, 'published'))!);
  return or(...clauses)!;
}

/** Content that may feed public aggregates (averages, measured speeds): public + published only. */
export function publicAggregateEligible(cols: Pick<GovernedColumns, 'visibility' | 'status'>): SQL {
  return sql`(${cols.visibility} = 'public' and ${cols.status} = 'published')`;
}
