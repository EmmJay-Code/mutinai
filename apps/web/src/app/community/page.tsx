import { community, getDb } from '@mutinai/db';
import { isModerator } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { verifySubmission } from '@/app/actions';
import { ReviewList, SubmissionTable } from '@/components/results';
import { PageHead, Section } from '@/components/ui';
import { searchParam } from '@/lib/format';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Community' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function CommunityPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const db = getDb();
  const viewer = await getViewer();
  const [stats, submissions, reviews] = await Promise.all([
    community.getCommunityStats(db),
    community.listSubmissions(db, {}, viewer, 40),
    community.listRecentReviews(db, viewer, 20),
  ]);
  const error = searchParam(sp, 'error');
  const submitted = searchParam(sp, 'submitted');
  const queue = isModerator(viewer) ? submissions.filter((s) => s.verification === 'unverified' && s.visibility !== 'private' && !s.isOwn) : [];

  return (
    <>
      <PageHead
        eyebrow="Community"
        title="Results and reviews from people running open models"
        lede="Benchmark runs record the full environment — artifact, hardware, runtime, version and settings — so results can be compared and reproduced. Reviews rate specific dimensions rather than a single score."
      >
        <Link className="btn btn-primary btn-small" href="/contribute/benchmark">Submit a benchmark run</Link>
        <Link className="btn btn-small" href="/contribute/review">Write a review</Link>
      </PageHead>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {submitted && <div className="alert alert-ok" role="status">Thanks — your run was recorded. It shows as unverified until a moderator checks it.</div>}

      <div className="stat-strip">
        <div><span className="n">{stats.profiles}</span><span className="l">Members</span></div>
        <div><span className="n">{stats.submissions}</span><span className="l">Public runs</span></div>
        <div><span className="n">{stats.verified}</span><span className="l">Verified runs</span></div>
        <div><span className="n">{stats.reviews}</span><span className="l">Public reviews</span></div>
      </div>

      {queue.length > 0 && (
        <Section title="Verification queue" more="Moderators">
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {queue.map((s) => (
                  <tr key={s.id}>
                    <td>{s.artifact.variantName} <span className="muted">{s.artifact.schemeName}</span></td>
                    <td className="small">{s.runtime.name} · @{s.submitter.handle}</td>
                    <td className="r">
                      <form action={verifySubmission} className="mod-actions">
                        <input type="hidden" name="submissionId" value={s.id} />
                        <button className="btn btn-small" name="state" value="verified">Verify</button>
                        <button className="btn btn-small btn-danger" name="state" value="disputed">Dispute</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Recent benchmark runs">
        <SubmissionTable submissions={submissions} />
      </Section>

      <Section title="Recent reviews">
        <div className="panel panel-pad">
          <ReviewList reviews={reviews} showSubject />
        </div>
      </Section>
    </>
  );
}
