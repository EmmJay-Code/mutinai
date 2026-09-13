import { catalog, community, compatQueries, getDb } from '@mutinai/db';
import Link from 'next/link';
import { EntityLink, FitBadge, LicenseShort, Speed } from '@/components/ui';
import { Avatar, CapabilityBars, EntityMark, FrontierChart, Heat, MemoryScale, MonthlyBars, SystemsMeter, type EntityType } from '@/components/viz';
import { entityHref, FORM_FACTOR_LABEL, formatDate, formatNumber, formatParams, humanize, isoDate } from '@/lib/format';

const PREVIEW_SYSTEM = 'rtx-4090-workstation';

const EVENT_ENTITY: Record<string, EntityType> = { model_release: 'model', runtime_release: 'tool', hardware_launch: 'hardware', benchmark_update: 'bench', announcement: 'event' };

/** Entry points phrased the way newcomers ask; each lands on a filtered, explained view. */
const QUESTIONS = [
  { href: '/run', label: 'What can my computer run?' },
  { href: '/models?for=coding#all-models', label: 'What’s good for coding?' },
  { href: '/hardware?goal=apple#catalog', label: 'Can a Mac run these?' },
  { href: '/hardware?goal=upgrade#catalog', label: 'Which GPU should I buy?' },
  { href: '/learn#run-locally', label: 'What does quantization mean?' },
];

const LEARN_PATHS = [
  { id: 'start-here', title: 'Start here', text: 'What open models are and why running them yourself matters.' },
  { id: 'run-locally', title: 'Run locally', text: 'Memory, quantization and runtimes decide what you can run.' },
  { id: 'understand-models', title: 'Understand models', text: 'Families, releases, variants and benchmarks, decoded.' },
  { id: 'build', title: 'Build with them', text: 'APIs, coding assistants, agents and fine-tuning.' },
];

const monthLong = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDevice = (n: string) => n.replace(/^(NVIDIA|AMD|Apple)\s+(GeForce\s+|Radeon\s+)?/, '');

export default async function DiscoverPage() {
  const db = getDb();
  const [events, months, frontier, models, stats, picker, submissions, reviews, profiles, summary, runtimes, devices] = await Promise.all([
    catalog.listEvents(db, { limit: 12 }),
    catalog.eventActivityByMonth(db, 12),
    catalog.benchmarkFrontier(db, 'gpqa-diamond'),
    catalog.listModels(db),
    community.getCommunityStats(db),
    compatQueries.listHardwarePickerOptions(db),
    community.listSubmissions(db, {}, undefined, 40),
    community.listRecentReviews(db, undefined, 10),
    catalog.listCapabilityProfiles(db),
    compatQueries.compatSummaryByModel(db, { contextLength: 8192 }),
    catalog.listProjects(db, { category: 'runtime' }),
    catalog.listDevices(db, { sort: 'bandwidth' }),
  ]);
  const previewHardware = await compatQueries.loadReferenceHardware(db, PREVIEW_SYSTEM);
  const preview = previewHardware ? await compatQueries.runCompatibility(db, previewHardware, { contextLength: 8192 }) : [];
  const picks = preview
    .filter((r) => r.recommended && r.recommended.result.placement === 'accelerator' && r.variantKind !== 'fine_tune')
    .sort((a, b) => b.paramsTotal - a.paramsTotal)
    .slice(0, 5);

  const latestMonth = months.at(-1);
  const best = frontier?.points.at(-1);

  // Reading order: what Mutinai is → the one development that matters → latest + trending → deeper trends → questions.
  const lead = events.find((e) => e.kind === 'model_release' || e.kind === 'hardware_launch') ?? events[0];
  const rest = events.filter((e) => e !== lead).slice(0, 8);
  const leadRelease = lead?.entities.find((e) => e.kind === 'model_release');
  const leadModel = leadRelease
    ? models.filter((m) => m.releaseSlug === leadRelease.slug).sort((a, b) => b.reviewCount + b.runCount - (a.reviewCount + a.runCount) || b.paramsTotal - a.paramsTotal)[0]
    : undefined;

  const activeModels = models.filter((m) => m.reviewCount + m.runCount > 0).sort((a, b) => b.reviewCount + b.runCount - (a.reviewCount + a.runCount)).slice(0, 3);
  const topRuntime = [...runtimes].sort((a, b) => b.resultCount - a.resultCount)[0];
  const topDevice = devices.filter((d) => d.deviceKind !== 'cpu').sort((a, b) => b.resultCount - a.resultCount)[0];
  const featuredRuns = [submissions.find((s) => s.verification === 'verified'), submissions.find((s) => s.verification !== 'verified')].filter(Boolean);
  const featuredReview = [...reviews].sort((a, b) => b.helpfulScore - a.helpfulScore)[0];
  const order = ['laptop', 'mini_pc', 'desktop', 'server'];
  const systemsByForm = Object.entries(
    picker.configurations.reduce<Record<string, typeof picker.configurations>>((acc, c) => ({ ...acc, [c.formFactor]: [...(acc[c.formFactor] ?? []), c] }), {}),
  ).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));

  return (
    <>
      <section className="opening" aria-labelledby="hero-title">
        <div>
          <div className="eyebrow">Open models · right now{latestMonth ? ` · data to ${monthLong(latestMonth.month)}` : ''}</div>
          <h1 id="hero-title">Everything happening in open models.</h1>
          <p className="lede">Open-weight models, the hardware they run on and the tools around them — measured, sourced, and checked against the machine you have.</p>
          <div className="opening-actions">
            <a className="btn btn-primary btn-large" href="#now">Explore what’s new</a>
            <Link className="btn btn-large" href="/run">What can I run?</Link>
          </div>
        </div>
        <dl className="stats" aria-label="The ecosystem at a glance">
          <div><dt>Open-weight models tracked</dt><dd>{models.length}</dd></div>
          <div><dt>Releases &amp; launches in {latestMonth ? monthLong(latestMonth.month) : 'the latest month'}</dt><dd>{latestMonth?.count ?? 0}</dd></div>
          <div><dt>Best open GPQA Diamond score{best ? ` · ${best.name}` : ''}</dt><dd>{best ? best.value.toFixed(1) : '—'}<small>%</small></dd></div>
          <div><dt>Verified community runs</dt><dd>{stats.verified}<small>of {stats.submissions}</small></dd></div>
        </dl>
      </section>

      <section className="region now" id="now" aria-labelledby="now-heading">
        <div className="section-head now-head">
          <h2 id="now-heading"><span className="glyph g-event" aria-hidden="true" /> Happening now</h2>
          <div className="more"><Link href="/new">Full timeline →</Link></div>
        </div>
        {lead && (
          <article className="lead" aria-labelledby="lead-title">
            <div>
              <div className="lead-flag">Top story</div>
              <div className="kicker"><EntityMark type={EVENT_ENTITY[lead.kind] ?? 'event'} word={humanize(lead.kind)} /> · <time dateTime={isoDate(lead.occurredAt)}>{formatDate(lead.occurredAt, 'long')}</time></div>
              <h3 id="lead-title">{lead.entities[0] && entityHref(lead.entities[0]) ? <Link href={entityHref(lead.entities[0])!}>{lead.title}</Link> : lead.title}</h3>
              {lead.summary && <p>{lead.summary}</p>}
              <div className="tags small">
                {lead.entities.map((e) => <EntityLink key={e.slug} entity={e} mark />)}
              </div>
            </div>
            {leadModel && (
              <div className="spec" aria-label={`${leadModel.name} at a glance`}>
                <div className="spec-row">
                  <Link href={`/models/${leadModel.slug}`} style={{ fontWeight: 600 }}><EntityMark type="model" /> {leadModel.name}</Link>
                  <LicenseShort commercialUse={leadModel.licenses.some((l) => l.commercialUse === 'allowed') ? 'allowed' : leadModel.licenses[0]?.commercialUse} />
                </div>
                <div className="spec-row">
                  <span className="k">Capability profile</span>
                  <CapabilityBars profile={profiles[leadModel.slug]} legend />
                </div>
                <MemoryScale gb={leadModel.minMemoryGb} label="Memory to run" />
                {summary[leadModel.slug] && (
                  <div className="spec-row"><span className="k">Runs well on</span><SystemsMeter runsWell={summary[leadModel.slug]!.runsWell} slow={summary[leadModel.slug]!.slow} of={summary[leadModel.slug]!.of} /></div>
                )}
                <div className="spec-row"><span className="k">Size</span><span className="num">{formatParams(leadModel.paramsTotal)}{leadModel.paramsActive ? ` · ${formatParams(leadModel.paramsActive)} active` : ''}</span></div>
              </div>
            )}
          </article>
        )}

        <div className="now-grid">
          <div>
            <h3 className="subhead">Latest</h3>
            <ol className="timeline-feed" aria-label="Recent events">
              {rest.map((e) => {
                const href = e.entities[0] ? entityHref(e.entities[0]) : null;
                return (
                  <li key={e.id}>
                    <time dateTime={isoDate(e.occurredAt)}>{formatDate(e.occurredAt).replace(/ \d{4}$/, '')}</time>
                    <span className="node"><EntityMark type={EVENT_ENTITY[e.kind] ?? 'event'} label={humanize(e.kind)} /></span>
                    <div>
                      <div className="title">{href ? <Link href={href}>{e.title}</Link> : e.title}</div>
                      {e.entities.some((x) => !e.title.toLowerCase().includes(x.name.toLowerCase())) && <div className="about">{e.entities.filter((x) => !e.title.toLowerCase().includes(x.name.toLowerCase())).map((x) => x.name).join(' · ')}</div>}
                    </div>
                    <span className="kind">{humanize(e.kind)}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          <aside className="rail" aria-label="Trending and community">
            <section className="rail-block" aria-labelledby="active-h">
              <h3 id="active-h">Trending <span>by community activity</span></h3>
              <ul className="mini-list">
                {activeModels.map((m) => (
                  <li key={m.slug}>
                    <EntityMark type="model" />
                    <Link href={`/models/${m.slug}`}>{m.name}<span className="sub">{m.runCount} run{m.runCount === 1 ? '' : 's'} · {m.reviewCount} review{m.reviewCount === 1 ? '' : 's'}</span></Link>
                    <Heat level={Math.min(3, m.reviewCount + m.runCount)} label={`${m.reviewCount + m.runCount} contributions`} />
                  </li>
                ))}
                {topRuntime && (
                  <li>
                    <EntityMark type="tool" />
                    <Link href={`/tools/${topRuntime.slug}`}>{topRuntime.name}<span className="sub">{topRuntime.resultCount} measurements</span></Link>
                    <Heat level={3} label="Most measured runtime" />
                  </li>
                )}
                {topDevice && (
                  <li>
                    <EntityMark type="hardware" />
                    <Link href={`/hardware/${topDevice.slug}`}>{shortDevice(topDevice.name)}<span className="sub">{topDevice.resultCount} measurements</span></Link>
                    <Heat level={2} label="Most measured hardware" />
                  </li>
                )}
              </ul>
            </section>
            <section className="rail-block" aria-labelledby="voices-h">
              <h3 id="voices-h">From the community <span><Link href="/community">all →</Link></span></h3>
              <ul className="mini-list">
                {featuredRuns.map((s) => {
                  const gen = s!.measurements.find((m) => ['tg128', 'gen_tps'].includes(m.key)) ?? s!.measurements[0]!;
                  return (
                    <li key={s!.id} style={{ gridTemplateColumns: '24px minmax(0,1fr)' }}>
                      <Avatar handle={s!.submitter.handle} />
                      <span>
                        <span className="val-measured">{formatNumber(gen.value)}</span> <span className="small muted">{gen.unit}</span> · <Link href={`/models/${s!.artifact.modelSlug}`}>{s!.artifact.variantName}</Link>
                        <span className="sub">{s!.hardware.type === 'reference' ? s!.hardware.name : s!.hardware.components.map((c) => c.name).join(' + ')} · @{s!.submitter.handle}{s!.verification === 'verified' ? ' · verified' : ''}</span>
                      </span>
                    </li>
                  );
                })}
                {featuredReview && (
                  <li style={{ gridTemplateColumns: '24px minmax(0,1fr)' }}>
                    <Avatar handle={featuredReview.author.handle} />
                    <span>
                      <span className="serif" style={{ fontSize: 14.5 }}>“{featuredReview.title}”</span>
                      <span className="sub">{featuredReview.subject.name} · @{featuredReview.author.handle}</span>
                    </span>
                  </li>
                )}
              </ul>
            </section>
          </aside>
        </div>
      </section>

      <section className="region" aria-labelledby="trends-h">
        <div className="section-head">
          <h2 id="trends-h">Ecosystem trends</h2>
          <div className="more"><Link href="/new">Full timeline →</Link></div>
        </div>
        <div className="trends">
          {frontier && (
            <figure className="trend-panel">
              <figcaption>
                <h3><span className="glyph g-bench" aria-hidden="true" /> Benchmark frontier · {frontier.benchmarkName}</h3>
                <p>Best developer-reported open score, stepping up each time a release beats it.</p>
              </figcaption>
              <FrontierChart points={frontier.points} width={460} height={170} />
            </figure>
          )}
          <figure className="trend-panel">
            <figcaption>
              <h3><span className="glyph g-event" aria-hidden="true" /> Releases and launches per month</h3>
              <p>Model releases, hardware launches, runtime releases and announcements tracked by Mutinai.</p>
            </figcaption>
            <MonthlyBars months={months} label="Releases and launches per month" />
          </figure>
        </div>
      </section>

      <section className="region" aria-labelledby="run-heading">
        <div className="run-band">
          <div>
            <div className="step">What can I run?</div>
            <h2 id="run-heading">Start from the machine you have.</h2>
            <p className="small muted" style={{ margin: 0 }}>Pick the closest setup — we recommend a download, a runtime, and show memory and speed.</p>
            <div className="system-picker">
              {systemsByForm.map(([form, systems]) => (
                <div className="picker-group" key={form}>
                  <h4>{FORM_FACTOR_LABEL[form] ?? humanize(form)}</h4>
                  <div className="chips">
                    {systems.map((s) => <Link key={s.slug} className="chip" href={`/run?system=${s.slug}`}>{s.name.replace(/\s*\(.*\)$/, '')}</Link>)}
                  </div>
                </div>
              ))}
              <div className="picker-group"><span /><Link href="/run?mode=custom" className="small link">Build your own setup →</Link></div>
            </div>
          </div>
          <div>
            <div className="section-head" style={{ marginBottom: 4 }}>
              <h2><span className="glyph g-system" aria-hidden="true" /> {previewHardware?.label}</h2>
              <div className="more"><Link href={`/run?system=${PREVIEW_SYSTEM}`}>Everything it runs →</Link></div>
            </div>
            <p className="small muted" style={{ margin: '0 0 4px' }}>Largest models that fit entirely in its 24 GB GPU, at 8K context.</p>
            <ul className="pick-list">
              {picks.map((p) => (
                <li key={p.variantSlug}>
                  <EntityMark type="variant" />
                  <div>
                    <Link className="name" href={`/models/${p.modelSlug}#${p.variantSlug}`}>{p.variantName}</Link>
                    <div className="small muted"><span className="num">{formatParams(p.paramsTotal)}</span> · <span className="mono">{p.recommended!.row.schemeName}</span> via {p.recommended!.runtime.name}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <FitBadge fit={p.recommended!.result.fit} />
                    <div className="small"><Speed speed={p.recommended!.result.speed} /></div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="region" aria-labelledby="explore-h">
        <div className="section-head"><h2 id="explore-h">Explore Mutinai</h2></div>
        <h3 className="explore-q">Start with a question</h3>
        <ul className="questions">
          {QUESTIONS.map((q) => <li key={q.href}><Link href={q.href}>{q.label}</Link></li>)}
        </ul>
        <div className="gateways">
          <Link href="/models" className="gateway">
            <span className="glyph g-model" aria-hidden="true" />
            <h3>Models</h3>
            <p>Find the right open model by what you want to do, and see what it needs to run.</p>
            <span className="gateway-links">{activeModels.map((m) => <span key={m.slug}>{m.name}</span>)}</span>
          </Link>
          <Link href="/hardware" className="gateway">
            <span className="glyph g-hardware" aria-hidden="true" />
            <h3>Hardware</h3>
            <p>A first machine, a GPU upgrade, a Mac or a server — compared by what they can hold.</p>
            <span className="gateway-links">{devices.filter((d) => d.deviceKind !== 'accelerator').slice(0, 3).map((d) => <span key={d.slug}>{shortDevice(d.name)}</span>)}</span>
          </Link>
          <Link href="/tools" className="gateway">
            <span className="glyph g-tool" aria-hidden="true" />
            <h3>Tools</h3>
            <p>Runtimes, interfaces, coding assistants and fine-tuning.</p>
            <span className="gateway-links">{[...runtimes].sort((a, b) => b.resultCount - a.resultCount).slice(0, 3).map((r) => <span key={r.slug}>{r.name}</span>)}</span>
          </Link>
        </div>
      </section>

      <section className="region" aria-labelledby="learn-h">
        <div className="section-head"><h2 id="learn-h">Learn</h2><div className="more"><Link href="/learn">All guides →</Link></div></div>
        <ol className="paths">
          {LEARN_PATHS.map((p) => (
            <li key={p.id}><Link href={`/learn#${p.id}`}><strong>{p.title}</strong><span>{p.text}</span></Link></li>
          ))}
        </ol>
      </section>
    </>
  );
}
