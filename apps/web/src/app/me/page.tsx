import { catalog, community, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createHardwareConfig, deleteMyAccount } from '@/app/actions';
import { ReviewList, SubmissionTable } from '@/components/results';
import { Empty, PageHead, Section, Visibility } from '@/components/ui';
import { formatGb, searchParam } from '@/lib/format';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Your account', robots: { index: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function MePage({ searchParams }: { searchParams: SP }) {
  const session = await getSession();
  if (!session) redirect('/signin?returnTo=/me');
  const sp = await searchParams;
  const db = getDb();
  const [configs, submissions, reviews, devices] = await Promise.all([
    community.listOwnHardwareConfigs(db, session.viewer),
    community.listSubmissions(db, { submitterHandle: session.profile.handle }, session.viewer),
    community.listReviewsByAuthor(db, session.profile.handle, session.viewer),
    catalog.listDevices(db, { sort: 'name' }),
  ]);
  const error = searchParam(sp, 'error');

  return (
    <>
      <PageHead
        eyebrow="Private · only you can see this page"
        title={session.profile.displayName}
        lede={<>Public handle <Link href={`/u/${session.profile.handle}`}>@{session.profile.handle}</Link>. Your email and account details are never shown on public pages or API responses.</>}
      />
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {searchParam(sp, 'saved') && <div className="alert alert-ok" role="status">Saved.</div>}

      <div className="grid grid-main-aside">
        <div>
          <Section title="My systems" id="systems">
            {configs.length ? (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Name</th><th>Components</th><th className="r">Memory</th><th>Visibility</th><th /></tr></thead>
                  <tbody>
                    {configs.map((c) => (
                      <tr key={c.id}>
                        <td className="primary">{c.name}</td>
                        <td className="small">{c.components.map((x) => `${x.count > 1 ? `${x.count}× ` : ''}${x.name}`).join(' + ')}</td>
                        <td className="r num">{c.unifiedMemoryGb ? `${formatGb(c.unifiedMemoryGb)} unified` : `${formatGb(c.systemRamGb)} RAM`}</td>
                        <td><Visibility visibility={c.visibility} />{c.visibility === 'public' && <span className="small muted">public</span>}</td>
                        <td className="r"><Link className="btn btn-small" href={`/run?mine=${c.id}`}>What runs?</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No saved systems yet.</Empty>}

            <details style={{ marginTop: 12 }} open={configs.length === 0}>
              <summary><strong>Add a system</strong></summary>
              <form action={createHardwareConfig} className="panel panel-pad form-stack" style={{ marginTop: 8 }}>
                <div className="form-grid">
                  <label className="field"><span>Name</span><input type="text" name="name" required maxLength={80} placeholder="Desk workstation" /></label>
                  <label className="field">
                    <span>Visibility</span>
                    <select name="visibility" defaultValue="private">
                      <option value="private">Private (default)</option>
                      <option value="unlisted">Unlisted</option>
                      <option value="public">Public</option>
                    </select>
                  </label>
                </div>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="form-grid">
                    <label className="field">
                      <span>Device {i + 1}{i > 0 ? ' (optional)' : ''}</span>
                      <select name={`device_${i}`} required={i === 0} defaultValue="">
                        <option value="">—</option>
                        {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </label>
                    <label className="field"><span>Count</span><input type="number" name={`count_${i}`} min="1" max="16" defaultValue={1} /></label>
                  </div>
                ))}
                <div className="form-grid">
                  <label className="field"><span>System RAM (GB)</span><input type="number" name="systemRamGb" min="0" defaultValue={32} /></label>
                  <label className="field"><span>Unified memory (GB)</span><input type="number" name="unifiedMemoryGb" min="0" placeholder="Apple / APU systems" /></label>
                  <label className="field"><span>RAM bandwidth (GB/s)</span><input type="number" name="systemRamBandwidthGbps" min="0" placeholder="optional" /></label>
                </div>
                <button className="btn btn-primary" type="submit">Save system</button>
              </form>
            </details>
          </Section>

          <Section title="My benchmark runs" more={<Link href="/contribute/benchmark">Submit a run →</Link>}>
            <SubmissionTable submissions={submissions} emptyText="You haven't submitted any runs." />
          </Section>

          <Section title="My reviews">
            <ReviewList reviews={reviews} showSubject emptyText="You haven't written any reviews." />
          </Section>
        </div>

        <aside>
          <div className="aside-block panel panel-pad small">
            <h3 style={{ marginBottom: 6 }}>Your data</h3>
            <dl className="kv">
              <dt>AI training</dt><dd>Not permitted <span className="faint">(default; opt-in only)</span></dd>
              <dt>Default visibility</dt><dd>Systems private; reviews and runs public</dd>
            </dl>
            <p style={{ marginTop: 10 }}>
              <a className="btn btn-small" href="/me/export">Download my data (JSON)</a>
            </p>
          </div>
          <div className="aside-block panel panel-pad small">
            <h3 style={{ marginBottom: 6 }}>Delete account</h3>
            <p className="muted">Deletes your account, profile, systems, reviews, runs and votes. This cannot be undone.</p>
            <form action={deleteMyAccount} className="form-stack">
              <label className="field"><span>Type @{session.profile.handle} without the @ to confirm</span><input type="text" name="confirm" autoComplete="off" /></label>
              <button className="btn btn-danger btn-small" type="submit">Delete my account</button>
            </form>
          </div>
        </aside>
      </div>
    </>
  );
}
