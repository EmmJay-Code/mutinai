import { catalog, community, compatQueries, getDb } from '@mutinai/db';
import Link from 'next/link';
import { SubmissionTable } from '@/components/results';
import { EntityLink, KindTag, Section, Tag } from '@/components/ui';
import { formatContext, formatDate, formatGb, formatParams, humanize, isoDate } from '@/lib/format';

export default async function OverviewPage() {
  const db = getDb();
  const [counts, events, releases, configurations, runtimes, stats, submissions, reviews, picker] = await Promise.all([
    catalog.getCatalogCounts(db),
    catalog.listEvents(db, { limit: 12 }),
    catalog.listRecentReleases(db, 8),
    catalog.listConfigurations(db),
    catalog.listProjects(db, { category: 'runtime' }),
    community.getCommunityStats(db),
    community.listSubmissions(db, {}, undefined, 5),
    community.listRecentReviews(db, undefined, 5),
    compatQueries.listHardwarePickerOptions(db),
  ]);

  const strip: [string, number, string][] = [
    ['Models', counts.model ?? 0, '/models'],
    ['Variants', counts.model_variant ?? 0, '/models'],
    ['Quantizations', counts.model_artifact ?? 0, '/models'],
    ['Hardware', counts.hardware_device ?? 0, '/hardware'],
    ['Systems', counts.hardware_configuration ?? 0, '/hardware?view=systems'],
    ['Tools', counts.project ?? 0, '/tools'],
    ['Results', counts.benchmark_result ?? 0, '/models'],
    ['Community runs', stats.submissions, '/community'],
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Ecosystem overview</div>
          <h1>Open models, the hardware they run on, and the tools around them</h1>
          <p className="lede">
            A structured, sourced map of the open-AI ecosystem: developers, model families, releases, variants and quantizations,
            hardware, runtimes, benchmarks and community results.
          </p>
        </div>
      </div>

      <nav className="stat-strip" aria-label="Catalog size">
        {strip.map(([label, n, href]) => (
          <Link key={label} href={href}>
            <span className="n">{n}</span>
            <span className="l">{label}</span>
          </Link>
        ))}
      </nav>

      <div className="grid grid-main-aside section">
        <div>
          <Section title="Latest model releases" more={<Link href="/models">All models →</Link>}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Release</th>
                    <th>Developer</th>
                    <th>Date</th>
                    <th>Sizes</th>
                    <th>License</th>
                  </tr>
                </thead>
                <tbody>
                  {releases.map((r) => (
                    <tr key={r.slug}>
                      <td>
                        <span className="primary">{r.name}</span>
                        <span className="sub">{r.summary}</span>
                      </td>
                      <td className="nowrap"><Link href={`/models?developer=${r.developerSlug}`}>{r.developerName}</Link></td>
                      <td className="num">{formatDate(r.releasedOn)}</td>
                      <td>
                        <div className="tags">
                          {r.models.map((m) => (
                            <Link key={m.slug} className="tag" href={`/models/${m.slug}`}>
                              {formatParams(m.paramsTotal)}{m.paramsActive ? `·A${formatParams(m.paramsActive)}` : ''}
                            </Link>
                          ))}
                        </div>
                      </td>
                      <td className="small">{r.licenseName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Ecosystem timeline">
            <ol className="timeline panel panel-pad">
              {events.map((e) => (
                <li key={e.id}>
                  <time dateTime={isoDate(e.occurredAt)}>{formatDate(e.occurredAt)}</time>
                  <div>
                    <div className="title">{e.url ? <a href={e.url} rel="noopener noreferrer">{e.title}</a> : e.title}</div>
                    {e.summary && <div className="small muted">{e.summary}</div>}
                    <div className="tags" style={{ marginTop: 4 }}>
                      <Tag>{humanize(e.kind)}</Tag>
                      {e.entities.map((x) => (
                        <span key={x.slug} className="small">
                          <EntityLink entity={x} />
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <aside>
          <div className="aside-block panel panel-pad">
            <h2 style={{ marginBottom: 8 }}>What can I run?</h2>
            <form action="/run" className="form-stack">
              <label className="field">
                <span>System</span>
                <select name="system" defaultValue="rtx-4090-workstation">
                  {picker.configurations.map((c) => (
                    <option key={c.slug} value={c.slug}>{c.name}</option>
                  ))}
                </select>
              </label>
              <div className="run-teaser">
                <label className="field">
                  <span>Context</span>
                  <select name="ctx" defaultValue="8192">
                    {[4096, 8192, 32768, 131072].map((c) => <option key={c} value={c}>{formatContext(c)} tokens</option>)}
                  </select>
                </label>
                <button className="btn btn-primary" type="submit">Check</button>
              </div>
            </form>
          </div>

          <div className="aside-block">
            <div className="section-head"><h2>Community</h2><Link className="more" href="/community">All activity →</Link></div>
            <p className="small muted">
              <span className="num">{stats.submissions}</span> public benchmark runs (<span className="num">{stats.verified}</span> verified) ·{' '}
              <span className="num">{stats.reviews}</span> reviews
            </p>
            <ul className="list-plain">
              {reviews.map((r) => (
                <li key={r.id}>
                  <div className="small"><KindTag kind={r.subject.kind} /> <EntityLink entity={r.subject} /></div>
                  <div>{r.title}</div>
                  <div className="byline">@{r.author.handle} · {formatDate(r.createdAt)}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="aside-block">
            <div className="section-head"><h2>Runtimes</h2><Link className="more" href="/tools?category=runtime">All →</Link></div>
            <ul className="list-plain">
              {runtimes.map((r) => (
                <li key={r.slug}>
                  <Link href={`/tools/${r.slug}`} className="primary">{r.name}</Link>{' '}
                  <span className="small muted">{r.runtime?.formats.join(', ')} · {r.runtime?.backends.join(', ')}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <Section title="Recent community benchmark runs" more={<Link href="/contribute/benchmark">Submit a run →</Link>}>
        <SubmissionTable submissions={submissions} />
      </Section>

      <Section title="Reference systems" more={<Link href="/hardware?view=systems">All systems →</Link>}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>System</th><th>Form factor</th><th className="r">Accelerator memory</th><th className="r">System RAM</th><th className="r">Measurements</th><th /></tr>
            </thead>
            <tbody>
              {configurations.map((c) => (
                <tr key={c.slug}>
                  <td><Link className="primary" href={`/hardware/systems/${c.slug}`}>{c.name}</Link><span className="sub">{c.components.map((x) => `${x.count > 1 ? `${x.count}× ` : ''}${x.name}`).join(' + ')}</span></td>
                  <td>{humanize(c.formFactor)}</td>
                  <td className="r num">{formatGb(c.acceleratorMemoryGb)}{c.unifiedMemoryGb ? ' unified' : ''}</td>
                  <td className="r num">{c.systemRamGb ? formatGb(c.systemRamGb) : '—'}</td>
                  <td className="r num">{c.resultCount}</td>
                  <td className="r"><Link className="btn btn-small" href={`/run?system=${c.slug}`}>What runs?</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
