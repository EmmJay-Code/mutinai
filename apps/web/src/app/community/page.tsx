import { community, getDb } from '@mutinai/db';
import { isModerator } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { verifySubmission } from '@/app/actions';
import { ReviewList, SubmissionList } from '@/components/results';
import { Disclosure, Section } from '@/components/ui';
import { searchParam } from '@/lib/format';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Community' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function CommunityPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const db = getDb();
  const viewer = await getViewer();
  const showAll = searchParam(sp, 'all') === '1';
  const [stats, submissions, reviews] = await Promise.all([
    community.getCommunityStats(db),
    community.listSubmissions(db, {}, viewer, 40),
    community.listRecentReviews(db, viewer, 20),
  ]);
  const error = searchParam(sp, 'error');
  const submitted = searchParam(sp, 'submitted');
  const queue = isModerator(viewer) ? submissions.filter((s) => s.verification === 'unverified' && s.visibility !== 'private' && !s.isOwn) : [];
  const runs = showAll ? submissions : submissions.slice(0, 5);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><span className="glyph g-member" aria-hidden="true" /> Community</div>
          <h1>What people are running, measuring and recommending.</h1>
          <p className="lede">Runs record exactly what was run and on what, so results can be reproduced. Reviews rate specific qualities, not a single score.</p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-primary" href="/contribute/benchmark">Submit a run</Link>
          <Link className="btn" href="/contribute/review">Write a review</Link>
        </div>
      </div>
      <div className="run-summary">
        <div><b>{stats.profiles}</b><span>members</span></div>
        <div><b>{stats.submissions}</b><span>public runs</span></div>
        <div><span className="fit fit-full" /><b>{stats.verified}</b><span>verified</span></div>
        <div><b>{stats.reviews}</b><span>reviews</span></div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {submitted && <div className="alert alert-ok" role="status">Thanks — your run was recorded. It shows as unverified until a moderator checks it.</div>}

      {queue.length > 0 && (
        <Section title="Verification queue" intro="Moderators: check that each run’s numbers are plausible for its hardware and settings." tight>
          <ul className="list-plain">
            {queue.map((s) => (
              <li key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <span>{s.artifact.variantName} <span className="muted">{s.artifact.schemeName} · {s.runtime.name} · @{s.submitter.handle}</span></span>
                <form action={verifySubmission} className="mod-actions">
                  <input type="hidden" name="submissionId" value={s.id} />
                  <button className="btn btn-small" name="state" value="verified">Verify</button>
                  <button className="btn btn-small btn-danger" name="state" value="disputed">Dispute</button>
                </form>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="split section-tight">
        <section aria-labelledby="runs-heading">
          <div className="section-head">
            <h2 id="runs-heading">Recent benchmark runs</h2>
            {!showAll && submissions.length > runs.length && <div className="more"><Link href="/community?all=1#runs-heading">Show all {submissions.length} →</Link></div>}
          </div>
          <SubmissionList submissions={runs} />
        </section>
        <section aria-labelledby="reviews-heading">
          <div className="section-head"><h2 id="reviews-heading">Recent reviews</h2></div>
          <ReviewList reviews={reviews.slice(0, showAll ? 20 : 5)} showSubject />
        </section>
      </div>

      <Section title="How contributions work" tight>
        <div className="prose">
          <Disclosure title="Verification" meta="Why some runs are marked verified">
            <p>New runs are unverified. Moderators verify runs whose numbers are consistent with the hardware and settings. Only verified, public runs feed the measured speeds in What can I run?.</p>
          </Disclosure>
          <Disclosure title="Visibility and privacy" meta="Public, unlisted and private">
            <p>Everything you contribute is public, unlisted (reachable by link, excluded from listings and averages) or private (only you). Public runs on your own systems show the hardware components, not your system’s name. Contributions are never used for AI training unless you opt in. <Link href="/about#privacy">Read the principles</Link>.</p>
          </Disclosure>
        </div>
      </Section>
    </>
  );
}
