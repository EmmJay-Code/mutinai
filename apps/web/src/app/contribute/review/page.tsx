import { catalog, getDb } from '@mutinai/db';
import { dimensionsFor, isReviewableKind, REVIEWABLE_KINDS } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ContributionsClosed } from '@/components/preview';
import { submitReview } from '@/app/actions';
import { Empty, EntityLink, KindTag, PageHead } from '@/components/ui';
import { entityHref, KIND_LABEL, searchParam } from '@/lib/format';
import { contributionsEnabled, getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Write a review' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ReviewFormPage({ searchParams }: { searchParams: SP }) {
  if (!contributionsEnabled()) return <ContributionsClosed title="Write a review" />;
  const sp = await searchParams;
  const db = getDb();
  const session = await getSession();
  const ref = searchParam(sp, 'entity');
  const error = searchParam(sp, 'error');
  const [kind, slug] = ref?.split(':') ?? [];
  const entity = kind && slug ? await catalog.getEntityRef(db, kind, slug) : null;
  const detail = entity ? await catalog.getEntityById(db, entity.id) : null;
  const returnTo = searchParam(sp, 'returnTo') ?? (detail ? entityHref(detail) : null) ?? '/community';
  const q = searchParam(sp, 'q');
  const hits = !entity && q ? await catalog.searchEntities(db, q, { kinds: [...REVIEWABLE_KINDS], limit: 20 }) : [];

  if (!session) {
    return (
      <>
        <PageHead eyebrow="Contribute" title="Write a review" />
        <Empty>
          <Link href={`/signin?returnTo=${encodeURIComponent(`/contribute/review${ref ? `?entity=${ref}` : ''}`)}`}>Sign in</Link> to write a review.
        </Empty>
      </>
    );
  }

  if (!entity) {
    return (
      <>
        <PageHead eyebrow="Contribute" title="Write a review" lede={`Reviews can be written for ${REVIEWABLE_KINDS.map((k) => KIND_LABEL[k]?.toLowerCase()).join(', ')}.`} />
        <form className="filters" action="/contribute/review">
          <label className="field" style={{ flex: '1 1 320px' }}><span>Find what you want to review</span><input type="search" name="q" defaultValue={q} autoFocus /></label>
          <button className="btn btn-primary" type="submit">Search</button>
        </form>
        {q && (hits.length ? (
          <ul className="list-plain panel panel-pad">
            {hits.map((h) => (
              <li key={`${h.kind}:${h.slug}`}>
                <KindTag kind={h.kind} /> <Link href={`/contribute/review?entity=${h.kind}:${h.slug}`}>{h.name}</Link>
              </li>
            ))}
          </ul>
        ) : <Empty>No reviewable entities matched.</Empty>)}
      </>
    );
  }

  if (!isReviewableKind(entity.kind)) {
    return <Empty>{KIND_LABEL[entity.kind]} entities cannot be reviewed.</Empty>;
  }

  const dimensions = dimensionsFor(entity.kind);
  const configurations = await catalog.listConfigurations(db);

  return (
    <>
      <PageHead
        eyebrow="Contribute · review"
        title={<>Review <EntityLink entity={detail ?? entity} /></>}
        lede="Rate only the dimensions you have real experience with. Reviews are public by default; unlisted reviews are reachable by link but excluded from listings and averages."
      >
        <KindTag kind={entity.kind} />
      </PageHead>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <form action={submitReview} className="panel panel-pad form-stack" style={{ maxWidth: 860 }}>
        <input type="hidden" name="entityId" value={entity.id} />
        <input type="hidden" name="entityRef" value={`${entity.kind}:${entity.slug}`} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <label className="field"><span>Title</span><input type="text" name="title" required minLength={3} maxLength={140} /></label>
        <fieldset>
          <legend>Ratings (1 = poor, 5 = excellent)</legend>
          <div className="rating-input">
            {dimensions.map((d) => (
              <div key={d.key} style={{ display: 'contents' }} role="radiogroup" aria-label={d.label}>
                <span title={d.description}>{d.label}</span>
                <label><input type="radio" name={`rating_${d.key}`} value="" defaultChecked /> <span className="faint">n/a</span></label>
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n}><input type="radio" name={`rating_${d.key}`} value={n} /> {n}</label>
                ))}
              </div>
            ))}
          </div>
        </fieldset>
        <label className="field"><span>Review</span><textarea name="body" required minLength={10} maxLength={10000} placeholder="What did you use it for, on what hardware, and what worked or didn’t?" /></label>
        <div className="form-grid">
          <label className="field">
            <span>Hardware used (optional)</span>
            <select name="hardwareConfigurationId" defaultValue="">
              <option value="">Not specified</option>
              {configurations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Visibility</span>
            <select name="visibility" defaultValue="public">
              <option value="public">Public</option>
              <option value="unlisted">Unlisted (link only)</option>
              <option value="private">Private (only me)</option>
            </select>
          </label>
        </div>
        <p className="small muted">Your review is attributed to your public handle @{session.profile.handle}. Mutinai does not use your contributions for AI training unless you opt in.</p>
        <button className="btn btn-primary" type="submit">Publish review</button>
      </form>
    </>
  );
}
