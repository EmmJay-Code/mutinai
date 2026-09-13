import { catalog, community, compatQueries, getDb } from '@mutinai/db';
import {
  activityByMonth,
  ARCHITECTURE_PHRASE,
  CAPABILITY_AXES,
  digestByKind,
  formatPrice,
  FRESHNESS,
  isFixtureEvent,
  memoryPhrase,
  profileMean,
  rankFamilies,
  rankTrending,
  selectDiscover,
  summariseFamily,
  TRENDING_METRICS,
  compat,
} from '@mutinai/domain';
import Link from 'next/link';
import { PathIcon } from '@/components/icons';
import { Basis, EntityLink, Explain, FitBadge, LicenseShort, Placeholder, Speed } from '@/components/ui';
import { Avatar, CapabilityBars, EntityMark, FrontierChart, Heat, MemoryScale, MonthlyBars, SystemsMeter } from '@/components/viz';
import { entityTypeOfEvent, EVENT_GROUPS } from '@/lib/events';
import { entityHref, FORM_FACTOR_LABEL, formatDate, formatNumber, formatParams, humanize, isoDate } from '@/lib/format';
import { bestDevicePrice, maxParamsAtQ4, roughParams } from '@/lib/hardware';

const PREVIEW_SYSTEM = 'rtx-4090-workstation';

/** Why anyone would run models themselves. Product statements, not data claims; each opens the surface that proves it. */
const OPEN_VALUE = [
  { title: 'Run models yourself', text: 'Download the weights and run them on your own machine — no account, no per-token bill.', href: '/run', label: 'What can I run?' },
  { title: 'Choose your hardware', text: 'A laptop, one graphics card, a Mac or a server. You decide what the model runs on.', href: '/hardware', label: 'Compare hardware' },
  { title: 'Control your data', text: 'Prompts, code and documents stay on the machine you ran them on.', href: '/learn#run-locally', label: 'How local models work' },
  { title: 'Customize the stack', text: 'Swap runtimes, shrink a model to fit your memory, or fine-tune one on your own data.', href: '/tools', label: 'Tools & runtimes' },
  { title: 'Avoid lock-in', text: 'The weights are files you keep. Nobody can withdraw, reprice or quietly change them.', href: '/learn#start-here', label: 'What “open” means' },
];

const LEARN_PATHS = [
  { id: 'start-here', title: 'Start here', text: 'What open models are and why running them yourself matters.' },
  { id: 'run-locally', title: 'Run locally', text: 'Memory, quantization and runtimes decide what you can run.' },
  { id: 'understand-models', title: 'Understand models', text: 'Families, releases, variants and benchmarks, decoded.' },
  { id: 'build', title: 'Build with them', text: 'APIs, coding assistants, agents and fine-tuning.' },
];

/** Entry points phrased the way newcomers ask; each lands on a filtered, explained view. */
const QUESTIONS = [
  { href: '/run', label: 'What can my computer run?' },
  { href: '/models?for=coding#all-models', label: 'What’s good for coding?' },
  { href: '/hardware?goal=apple#catalog', label: 'Can a Mac run these?' },
  { href: '/hardware?goal=upgrade#catalog', label: 'Which GPU should I buy?' },
  { href: '/learn#run-locally', label: 'What does quantization mean?' },
];

const DAY = 86_400_000;
const shortDevice = (n: string) => n.replace(/^(NVIDIA|AMD|Apple)\s+(GeForce\s+|Radeon\s+)?/, '');
/** Day and month; the year too when it is not the current one, so older items never read as this year's. */
const eventDate = (d: Date | string, now: Date) => (new Date(d).getUTCFullYear() === now.getUTCFullYear() ? formatDate(d).replace(/ \d{4}$/, '') : formatDate(d));
const TRENDING_UNIT: Record<string, string> = { stars: 'GitHub stars', likes: 'Hugging Face likes' };
/** Local use means it fits a 24 GB card or Mac at 8K context — the same threshold the Models “Run locally” path uses. */
const LOCAL_MEMORY_GB = 22;

export default async function DiscoverPage() {
  const db = getDb();
  const now = new Date();
  const [events, observations, liveStatus, frontier, models, stats, picker, submissions, reviews, profiles, summary, runtimes, devices, counts, bestScores, observedPrices] = await Promise.all([
    catalog.listEvents(db, { limit: 1000 }),
    catalog.listMetricObservations(db, { since: new Date(now.getTime() - (FRESHNESS.trendingDays + FRESHNESS.trendingBaselineMaxDays + 1) * DAY), metrics: TRENDING_METRICS }),
    catalog.liveSourceStatus(db),
    catalog.benchmarkFrontier(db, 'gpqa-diamond'),
    catalog.listModels(db),
    community.getCommunityStats(db),
    compatQueries.listHardwarePickerOptions(db),
    community.listSubmissions(db, {}, undefined, 40),
    community.listRecentReviews(db, undefined, 10),
    catalog.listCapabilityProfiles(db),
    compatQueries.compatSummaryByModel(db, { contextLength: 8192 }),
    catalog.listProjects(db, { category: 'runtime' }),
    catalog.listDevices(db, { sort: 'memory' }),
    catalog.getCatalogCounts(db),
    catalog.listBestBenchmarkScores(db),
    catalog.listLatestDevicePrices(db),
  ]);
  const previewHardware = await compatQueries.loadReferenceHardware(db, PREVIEW_SYSTEM);
  const preview = previewHardware ? await compatQueries.runCompatibility(db, previewHardware, { contextLength: 8192 }) : [];
  const picks = preview
    .filter((r) => r.recommended && r.recommended.result.placement === 'accelerator' && r.variantKind !== 'fine_tune')
    .sort((a, b) => b.paramsTotal - a.paramsTotal)
    .slice(0, 5);

  const best = frontier?.points.at(-1);

  // Reading order: why open models → what changed → what members report → where to explore → families → benchmarks → hardware.
  // Time-sensitive selection follows docs/freshness.md: event time only, fixtures never compete with live data.
  const { mode, topStory: lead, latest: rest, recentReleaseCount } = selectDiscover(events, now, { latestLimit: 8 });
  const digest = digestByKind(events, now, EVENT_GROUPS);
  const months = activityByMonth(events, now, 12);
  const trending = rankTrending(observations, now);
  const trendingItems = [...trending.filter((t) => t.metric === 'stars').slice(0, 3), ...trending.filter((t) => t.metric === 'likes').slice(0, 2)];
  const topGain = (metric: string) => Math.max(...trending.filter((t) => t.metric === metric).map((t) => t.gain), 1);
  const leadRelease = lead?.entities.find((e) => e.kind === 'model_release');
  const leadModel = leadRelease
    ? models.filter((m) => m.releaseSlug === leadRelease.slug).sort((a, b) => b.reviewCount + b.runCount - (a.reviewCount + a.runCount) || b.paramsTotal - a.paramsTotal)[0]
    : undefined;

  const activeModels = models.filter((m) => m.reviewCount + m.runCount > 0).sort((a, b) => b.reviewCount + b.runCount - (a.reviewCount + a.runCount)).slice(0, 3);
  const featuredRuns = submissions.slice(0, 3);
  const featuredReviews = [...reviews].sort((a, b) => b.helpfulScore - a.helpfulScore).slice(0, 2);
  const order = ['laptop', 'mini_pc', 'desktop', 'server'];
  const systemsByForm = Object.entries(
    picker.configurations.reduce<Record<string, typeof picker.configurations>>((acc, c) => ({ ...acc, [c.formFactor]: [...(acc[c.formFactor] ?? []), c] }), {}),
  ).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));

  // Families: the unit people actually follow. Folded from the models already loaded, never a separate editorial list.
  const families = rankFamilies(
    Object.values(
      models.reduce<Record<string, { slug: string; name: string; developer: string; developerSlug: string; models: typeof models }>>((acc, m) => {
        const entry = acc[m.familySlug] ?? { slug: m.familySlug, name: m.familyName, developer: m.developerName, developerSlug: m.developerSlug, models: [] };
        return { ...acc, [m.familySlug]: { ...entry, models: [...entry.models, m] } };
      }, {}),
    ).map((f) => ({ ...f, summary: summariseFamily(f.models) })),
  ).slice(0, 6);

  // Benchmarks: one concept per card, ranked on a single test so every number on a card shares one scale.
  // The test shown is the one with the most recorded results for that concept; concepts without results are dropped.
  const axes = CAPABILITY_AXES.flatMap((axis) => {
    const sets = axis.benchmarks.map((slug) => bestScores.filter((s) => s.benchmarkSlug === slug)).filter((set) => set.length > 0);
    const chosen = sets.sort((a, b) => b.length - a.length || a[0]!.benchmarkSlug.localeCompare(b[0]!.benchmarkSlug))[0];
    if (!chosen) return [];
    const top = Math.max(...chosen.map((s) => s.value));
    return [{
      axis,
      benchmarkName: chosen[0]!.benchmarkName,
      leaders: [...chosen].sort((a, b) => b.value - a.value).slice(0, 3).map((s) => ({ ...s, share: top > 0 ? Math.round((s.value / top) * 100) : 0 })),
    }];
  });
  const localLeaders = models
    .filter((m) => m.minMemoryGb != null && m.minMemoryGb <= LOCAL_MEMORY_GB)
    .sort((a, b) => profileMean(profiles[b.slug]) - profileMean(profiles[a.slug]) || (a.minMemoryGb ?? 0) - (b.minMemoryGb ?? 0))
    .slice(0, 3);
  // Mutinai's capability axes are the only mapping from benchmark to concept and none of them covers images, so the
  // multimodal card says plainly that there is nothing to rank rather than guessing a benchmark's subject from its name.
  const visionModels = models.filter((m) => m.capabilities.includes('vision'));

  // Hardware: memory tiers from the devices that state their own memory; unified-memory chips are sized per system.
  const memoryTiers = Object.entries(
    devices.filter((d) => d.memoryKind === 'dedicated' && d.memoryGb).reduce<Record<number, typeof devices>>((acc, d) => ({ ...acc, [d.memoryGb!]: [...(acc[d.memoryGb!] ?? []), d] }), {}),
  )
    .map(([gb, list]) => ({ gb: Number(gb), devices: list }))
    .sort((a, b) => b.gb - a.gb);
  const unifiedDevices = devices.filter((d) => d.memoryKind === 'unified');
  const hardwareEvents = rest.concat(lead ? [lead] : []).filter((e) => e.kind === 'hardware_launch').sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt)).slice(0, 3);

  const researchCount = events.filter((e) => EVENT_GROUPS.find((g) => g.key === 'research')!.kinds.includes(e.kind)).length;
  const exploreAreas: { href: string; glyph?: string; icon?: string; title: string; text: string; facts: string[] }[] = [
    { href: '/models', glyph: 'g-model', title: 'Models', text: 'Open-weight models by what you want to do, and what each one needs to run.', facts: [`${counts.model ?? 0} models`, `${counts.model_family ?? 0} families`, `${counts.model_artifact ?? 0} downloads`] },
    { href: '/hardware', glyph: 'g-hardware', title: 'Hardware', text: 'Graphics cards, Apple silicon and complete systems, compared by what they can hold.', facts: [`${counts.hardware_device ?? 0} devices`, `${counts.hardware_configuration ?? 0} reference systems`] },
    { href: '/tools', glyph: 'g-tool', title: 'Tools & runtimes', text: 'The programs that load and serve models: runtimes, interfaces, assistants, fine-tuning.', facts: [`${counts.project ?? 0} projects`, `${runtimes.length} runtimes`] },
    { href: '/benchmarks', glyph: 'g-bench', title: 'Benchmarks', text: 'How models are compared, what each test measures, and who reported the score.', facts: [`${counts.benchmark ?? 0} benchmarks`, `${counts.benchmark_result ?? 0} results`] },
    { href: '/new?kind=research', glyph: 'g-event', title: 'Research & news', text: 'Papers and announcements from the labs and projects, on the timeline with everything else.', facts: [researchCount ? `${researchCount} papers & announcements` : 'Nothing tracked yet'] },
    { href: '/learn', icon: 'learn', title: 'Learn', text: 'Plain-language guides: what the words mean, what fits your machine, what to build with.', facts: [`${LEARN_PATHS.length} guides`] },
  ];

  return (
    <>
      <section className="opening" aria-labelledby="hero-title">
        <div>
          <div className="eyebrow">Open models · {mode === 'live' ? (liveStatus.lastCheckedAt ? `sources checked ${formatDate(liveStatus.lastCheckedAt)}` : 'live sources') : 'illustrative fixture data'}</div>
          <h1 id="hero-title">AI you can download, run and keep.</h1>
          <p className="lede">
            Open models are published as files anyone can download: you run them on your own hardware instead of sending your work to
            someone else’s. Mutinai tracks the models, the machines they fit and the tools that run them, and labels every figure with
            where it came from.
          </p>
          <div className="opening-actions">
            <a className="btn btn-primary btn-large" href="#now">What’s happening right now</a>
            <Link className="btn btn-large" href="/run">What can I run?</Link>
          </div>
        </div>
        <dl className="stats" aria-label="The ecosystem at a glance">
          <div><dt>Open-weight models tracked</dt><dd>{models.length}</dd></div>
          <div><dt>Releases &amp; launches in the last {FRESHNESS.recentDays} days</dt><dd>{recentReleaseCount}</dd></div>
          <div><dt>Best open GPQA Diamond score{best ? ` · ${best.name}` : ''}</dt><dd>{best ? best.value.toFixed(1) : '—'}<small>%</small></dd></div>
          <div><dt>Verified community runs</dt><dd>{stats.verified}<small>of {stats.submissions}</small></dd></div>
        </dl>
        <ul className="why" aria-label="Why run open models yourself">
          {OPEN_VALUE.map((v) => (
            <li key={v.title}>
              <strong>{v.title}</strong>
              <p>{v.text}</p>
              <Link className="small link" href={v.href}>{v.label} →</Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="region now" id="now" aria-labelledby="now-heading">
        <div className="section-head now-head">
          <h2 id="now-heading"><span className="glyph g-event" aria-hidden="true" /> What’s happening right now</h2>
          <div className="more"><Link href="/new">Full timeline →</Link></div>
        </div>

        <ul className="kind-digest" aria-label={`Tracked changes by part of the ecosystem, last ${FRESHNESS.recentDays} days`}>
          {EVENT_GROUPS.map((group) => {
            const d = digest.find((x) => x.key === group.key)!;
            return (
              <li key={group.key}>
                <Link href={`/new?kind=${group.key}`}>
                  <span className="kd-head"><EntityMark type={group.type} /> {group.label}</span>
                  <span className="kd-count">{d.recentCount}<small>in {FRESHNESS.recentDays} days</small></span>
                  <span className="kd-last">
                    {d.latest
                      ? <>Latest: {d.latest.title} <span className="faint">· {eventDate(d.latest.occurredAt, now)}</span></>
                      : <span className="faint">Nothing tracked yet</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        {lead ? (
          <article className="lead" aria-labelledby="lead-title">
            <div>
              <div className="lead-flag">Top story</div>
              <div className="kicker"><EntityMark type={entityTypeOfEvent(lead.kind)} word={humanize(lead.kind)} /> · <time dateTime={isoDate(lead.occurredAt)}>{formatDate(lead.occurredAt, 'long')}</time></div>
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
                <div className="spec-row"><span className="k"><Explain term="parameters">Size</Explain></span><span className="num">{formatParams(leadModel.paramsTotal)}{leadModel.paramsActive ? ` · ${formatParams(leadModel.paramsActive)} active` : ''}</span></div>
              </div>
            )}
          </article>
        ) : (
          <article className="lead lead-quiet" aria-labelledby="lead-title">
            <div>
              <div className="lead-flag">No top story</div>
              <h3 id="lead-title">Nothing major in the last {FRESHNESS.topStoryDays} days</h3>
              <p>
                {!events.length
                  ? 'No events are tracked yet. Model releases, hardware launches, runtime versions, benchmark updates and research appear here as soon as a source reports them.'
                  : mode === 'live'
                    ? 'A top story needs a model release, a hardware launch or a new runtime version from the past two weeks. The latest tracked events are below.'
                    : 'Only illustrative fixture data is loaded, so nothing here is current. The latest fixture events are below.'}
              </p>
            </div>
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
                    <time dateTime={isoDate(e.occurredAt)}>{eventDate(e.occurredAt, now)}</time>
                    <span className="node"><EntityMark type={entityTypeOfEvent(e.kind)} label={humanize(e.kind)} /></span>
                    <div>
                      <div className="title">{href ? <Link href={href}>{e.title}</Link> : e.title}</div>
                      {e.entities.some((x) => !e.title.toLowerCase().includes(x.name.toLowerCase())) && <div className="about">{e.entities.filter((x) => !e.title.toLowerCase().includes(x.name.toLowerCase())).map((x) => x.name).join(' · ')}</div>}
                    </div>
                    <span className="kind">{humanize(e.kind)}{isFixtureEvent(e) && <> <Basis kind="fixture" title="Illustrative fixture data">Fixture</Basis></>}</span>
                  </li>
                );
              })}
            </ol>
            {!rest.length && <p className="small muted">No events tracked yet.</p>}
          </div>

          <aside className="rail" aria-label="Trending and release activity">
            <section className="rail-block" aria-labelledby="active-h">
              <h3 id="active-h">Trending <span>growth over {FRESHNESS.trendingDays} days</span></h3>
              {trendingItems.length ? (
                <ul className="mini-list">
                  {trendingItems.map((t) => {
                    const href = entityHref(t.entity);
                    const label = <>{t.entity.name}<span className="sub">+{formatNumber(t.gain)} {TRENDING_UNIT[t.metric]} since {formatDate(t.since)}</span></>;
                    return (
                      <li key={`${t.entityId}-${t.metric}`}>
                        <EntityMark type={t.entity.kind === 'project' ? 'tool' : t.entity.kind === 'model' ? 'model' : 'variant'} />
                        {href ? <Link href={href}>{label}</Link> : <span>{label}</span>}
                        <Heat level={Math.max(1, Math.round((3 * t.gain) / topGain(t.metric)))} label={`+${t.gain} ${TRENDING_UNIT[t.metric]}`} />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  {`Not enough history yet. Trending compares GitHub stars and Hugging Face likes a week apart${liveStatus.firstCheckedAt ? `; tracking began ${formatDate(liveStatus.firstCheckedAt)}.` : ', and needs live sources.'}`}
                </p>
              )}
            </section>
            <section className="rail-block" aria-labelledby="activity-h" style={{ marginTop: 'var(--s5)' }}>
              <h3 id="activity-h">Releases per month</h3>
              <MonthlyBars months={months} label="Releases and launches per month" />
              <p className="small muted" style={{ margin: '6px 0 0' }}>
                Model releases, hardware launches and new runtime versions, by the date they happened.
                {mode === 'live' && liveStatus.firstCheckedAt ? ` Live tracking began ${formatDate(liveStatus.firstCheckedAt)}; earlier months hold only the history sources still list.` : ''}
              </p>
            </section>
          </aside>
        </div>
      </section>

      <section className="region" id="community" aria-labelledby="community-heading">
        <div className="section-head">
          <h2 id="community-heading"><span className="glyph g-member" aria-hidden="true" /> What the community is talking about</h2>
          <div className="more"><Link href="/community">All contributions →</Link></div>
        </div>
        <div className="signal">
          <p className="signal-note">
            <Basis kind="community">Community</Basis>{' '}
            Written and measured by members — kept separate from the sourced facts everywhere else on this page, and never merged into them.
          </p>
          {featuredRuns.length || featuredReviews.length ? (
            <div className="signal-grid">
              <section aria-labelledby="runs-h">
                <h3 id="runs-h" className="subhead">Runs members measured</h3>
                {featuredRuns.length ? (
                  <ul className="mini-list">
                    {featuredRuns.map((s) => {
                      const gen = s.measurements.find((m) => ['tg128', 'gen_tps'].includes(m.key)) ?? s.measurements[0]!;
                      return (
                        <li key={s.id} style={{ gridTemplateColumns: '24px minmax(0,1fr)' }}>
                          <Avatar handle={s.submitter.handle} />
                          <span>
                            <span className="val-measured">{formatNumber(gen.value)}</span> <span className="small muted"><Explain term="tokens-per-second">{gen.unit}</Explain></span> · <Link href={`/models/${s.artifact.modelSlug}`}>{s.artifact.variantName}</Link>
                            <span className="sub">{s.hardware.type === 'reference' ? s.hardware.name : s.hardware.components.map((c) => c.name).join(' + ')} · @{s.submitter.handle}{s.verification === 'verified' ? ' · verified by a moderator' : ' · not verified yet'}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="small muted" style={{ margin: 0 }}>No runs submitted yet.</p>}
              </section>
              <section aria-labelledby="reviews-h">
                <h3 id="reviews-h" className="subhead">What members wrote</h3>
                {featuredReviews.length ? (
                  <ul className="mini-list">
                    {featuredReviews.map((r) => (
                      <li key={r.id} style={{ gridTemplateColumns: '24px minmax(0,1fr)' }}>
                        <Avatar handle={r.author.handle} />
                        <span>
                          <span className="serif" style={{ fontSize: 14.5 }}>“{r.title}”</span>
                          <span className="sub">{r.subject.name} · @{r.author.handle}{r.helpfulScore > 0 ? ` · ${r.helpfulScore} found this helpful` : ''}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="small muted" style={{ margin: 0 }}>No reviews written yet.</p>}
              </section>
              {activeModels.length > 0 && (
                <p className="signal-most small" style={{ gridColumn: '1 / -1' }}>
                  Most discussed here: {activeModels.map((m, i) => <span key={m.slug}>{i > 0 && ' · '}<Link href={`/models/${m.slug}`}>{m.name}</Link></span>)}
                  <span className="muted"> — by how many member runs and reviews each has, not by how good it is.</span>
                </p>
              )}
              <Placeholder title="Discussion across the wider community">
                Mutinai does not collect discussion or sentiment from forums, chat and social posts yet. When it does, it will appear
                here, attributed and dated, and still separate from sourced facts — so nothing on this page is ever an opinion in disguise.
              </Placeholder>
            </div>
          ) : (
            <Placeholder title="Nothing from the community yet">
              Member runs and reviews appear here as soon as they are submitted. Mutinai shows no discussion, ratings or sentiment
              until real contributions exist — an empty section is more useful than an invented one.
            </Placeholder>
          )}
        </div>
      </section>

      <section className="region" id="explore" aria-labelledby="explore-h">
        <div className="section-head"><h2 id="explore-h">Explore the ecosystem</h2></div>
        <h3 className="explore-q">Start with a question</h3>
        <ul className="questions">
          {QUESTIONS.map((q) => <li key={q.href}><Link href={q.href}>{q.label}</Link></li>)}
        </ul>
        <div className="gateways six">
          {exploreAreas.map((a) => (
            <Link key={a.href} href={a.href} className="gateway">
              {a.glyph ? <span className={`glyph ${a.glyph}`} aria-hidden="true" /> : <PathIcon name={a.icon!} size={14} />}
              <h3>{a.title}</h3>
              <p>{a.text}</p>
              <span className="gateway-links">{a.facts.map((f) => <span key={f}>{f}</span>)}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="region" id="families" aria-labelledby="families-h">
        <div className="section-head">
          <div>
            <h2 id="families-h"><span className="glyph g-model" aria-hidden="true" /> Models worth knowing</h2>
            <p>Open models arrive in families. Start with the family and who builds it, then open a release to see its sizes and variants.</p>
          </div>
          <div className="more"><Link href="/models">All models →</Link></div>
        </div>
        {families.length ? (
          <ul className="family-list">
            {families.map((f) => (
              <li key={f.slug}>
                <div className="fam-id">
                  <h3><Link href={`/models?family=${f.slug}`}>{f.name}</Link></h3>
                  <div className="by">{f.developer}</div>
                </div>
                <div className="fam-known">
                  <span className="fam-label">Known for</span>
                  {f.summary.knownFor}
                </div>
                <div className="fam-facts">
                  <span>
                    {f.summary.paramsMin != null && (
                      <>{f.summary.paramsMin === f.summary.paramsMax ? formatParams(f.summary.paramsMax) : `${formatParams(f.summary.paramsMin)} – ${formatParams(f.summary.paramsMax)}`}{' '}
                        <Explain term="parameters">parameters</Explain></>
                    )}
                  </span>
                  <span>{f.summary.architecture === 'dense' ? 'Dense' : f.summary.architecture ? <Explain term="moe">{ARCHITECTURE_PHRASE[f.summary.architecture]}</Explain> : null}</span>
                  <span>{f.summary.latestReleasedOn ? `Newest release ${formatDate(f.summary.latestReleasedOn)}` : 'No release date recorded'}</span>
                </div>
                <div className="fam-models">
                  {f.models.slice(0, 3).map((m) => <Link key={m.slug} className="chip" href={`/models/${m.slug}`}>{m.name}</Link>)}
                  {f.summary.modelCount > 3 && <Link className="small link" href={`/models?family=${f.slug}`}>all {f.summary.modelCount} →</Link>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No model families tracked yet.</p>
        )}
      </section>

      <section className="region" id="benchmarks" aria-labelledby="bench-h">
        <div className="section-head">
          <div>
            <h2 id="bench-h"><span className="glyph g-bench" aria-hidden="true" /> How they compare</h2>
            <p>
              A <Explain term="benchmark" /> is a fixed set of questions every model answers, so scores can be compared.
              Positions below are relative to the best open result Mutinai holds for that test.
            </p>
          </div>
          <div className="more"><Link href="/benchmarks">All benchmarks →</Link></div>
        </div>
        <div className="bench-groups">
          {axes.map(({ axis, benchmarkName, leaders }) => (
            <section key={axis.key} className="bench-group" aria-labelledby={`bench-${axis.key}`}>
              <h3 id={`bench-${axis.key}`}>{axis.label} <span>best scores on {benchmarkName}</span></h3>
              <ol className="bench-list">
                {leaders.map((s) => (
                  <li key={s.modelSlug}>
                    <Link className="name" href={`/models/${s.modelSlug}`}>{s.modelName}</Link>
                    <span className="val">{s.value.toFixed(1)}</span>
                    <span className="bar" aria-hidden="true"><i style={{ width: `${s.share}%` }} /></span>
                  </li>
                ))}
              </ol>
              <p className="bench-basis"><Basis kind="source" title="Reported by the model's developer, not measured by Mutinai">developer-reported</Basis> <Link className="link nowrap" href="/benchmarks">what it measures →</Link></p>
            </section>
          ))}

          <section className="bench-group" aria-labelledby="bench-local">
            <h3 id="bench-local">Runs on your own machine</h3>
            <ol className="bench-list">
              {localLeaders.map((m) => {
                const mem = memoryPhrase(m.minMemoryGb);
                const s = summary[m.slug];
                return (
                  <li key={m.slug}>
                    <Link className="name" href={`/models/${m.slug}`}>{m.name}</Link>
                    <span className="val small">{mem?.amount}</span>
                    <span className="src small muted">{s ? `runs well on ${s.runsWell} of ${s.of} reference systems` : mem?.fits}</span>
                  </li>
                );
              })}
            </ol>
            {!localLeaders.length && <p className="small muted">No model in the catalog fits {LOCAL_MEMORY_GB} GB yet.</p>}
            <p className="bench-basis"><Basis kind="estimated" title="Memory estimated by the compatibility engine from file size, quantization and context">estimated</Basis> <span className="small muted">smallest download at 8K <Explain term="context" /></span></p>
          </section>

          <section className="bench-group" aria-labelledby="bench-mm">
            <h3 id="bench-mm">Images and multimodal</h3>
            <p className="small muted">
              {visionModels.length
                ? <>{visionModels.length} tracked model{visionModels.length === 1 ? '' : 's'} accept{visionModels.length === 1 ? 's' : ''} images, but Mutinai holds no multimodal benchmark results yet, so there is nothing to rank here. <Link className="link" href="/models?capability=vision#all-models">See the models →</Link></>
                : 'No models that accept images, and no multimodal benchmark results, are tracked yet.'}
            </p>
          </section>
        </div>
        {frontier && (
          <figure className="trend-panel wide" style={{ marginTop: 'var(--s4)' }}>
            <figcaption>
              <h3><span className="glyph g-bench" aria-hidden="true" /> Best open score over time · {frontier.benchmarkName}</h3>
              <p>Each step is a release that beat the previous best open result. Developer-reported scores.</p>
            </figcaption>
            <FrontierChart points={frontier.points} width={460} height={170} />
          </figure>
        )}
      </section>

      <section className="region" id="hardware" aria-labelledby="hw-h">
        <div className="section-head">
          <div>
            <h2 id="hw-h"><span className="glyph g-hardware" aria-hidden="true" /> Hardware watch</h2>
            <p>Memory decides what fits; memory speed decides how fast it answers. Prices are shown only with what they mean and when they were checked.</p>
          </div>
          <div className="more"><Link href="/hardware">All hardware →</Link></div>
        </div>

        {hardwareEvents.length > 0 && (
          <ul className="hw-launches" aria-label="Recent hardware launches">
            {hardwareEvents.map((e) => (
              <li key={e.id}>
                <span className="kicker"><EntityMark type="hardware" word="Launch" /> · <time dateTime={isoDate(e.occurredAt)}>{eventDate(e.occurredAt, now)}</time></span>
                <span className="t">{e.entities[0] && entityHref(e.entities[0]) ? <Link href={entityHref(e.entities[0])!}>{e.title}</Link> : e.title}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="hw-tiers">
          <div>
            <h3 className="subhead"><Explain term="vram">Graphics memory</Explain> tiers</h3>
            <ul className="tier-list">
              {memoryTiers.map((t) => (
                <li key={t.gb}>
                  <span className="tier-gb num">{t.gb}<small>GB</small></span>
                  <span className="tier-fit">Holds models up to {roughParams(maxParamsAtQ4(t.gb * compat.COMPAT_CONSTANTS.dedicatedUsableFraction))} at 4-bit <Basis kind="estimated">estimated</Basis></span>
                  <span className="tier-devices">
                    {t.devices.map((d) => {
                      const price = bestDevicePrice(d, observedPrices[d.slug]);
                      const p = price ? formatPrice(price) : null;
                      return (
                        <span key={d.slug} className="tier-device">
                          <Link href={`/hardware/${d.slug}`}>{shortDevice(d.name)}</Link>
                          {p && <em title={p.description}>{p.value} <span className="faint">{p.qualifier}</span></em>}
                        </span>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
            {!memoryTiers.length && <p className="small muted">No devices with recorded memory yet.</p>}
            <p className="small muted" style={{ marginTop: 'var(--s3)' }}>
              Mutinai records launch prices (<Explain term="msrp" />) and, where a retail price has been checked, the date it was
              checked. It keeps no price history yet, so it shows no price trends.
            </p>
          </div>
          <div>
            <h3 className="subhead"><Explain term="unified-memory">Unified memory</Explain></h3>
            <p className="small muted" style={{ marginTop: 0 }}>These chips share one pool of memory with the processor, so what fits is chosen when the machine is bought, not by the chip.</p>
            <ul className="mini-list">
              {unifiedDevices.slice(0, 5).map((d) => (
                <li key={d.slug}>
                  <EntityMark type="hardware" />
                  <Link href={`/hardware/${d.slug}`}>{shortDevice(d.name)}<span className="sub">{d.vendor.name}{d.memoryBandwidthGbps ? ` · ${formatNumber(d.memoryBandwidthGbps, 0)} GB/s memory speed` : ''}</span></Link>
                </li>
              ))}
            </ul>
            {!unifiedDevices.length && <p className="small muted">No unified-memory devices tracked yet.</p>}
          </div>
        </div>

        {(systemsByForm.length > 0 || picks.length > 0) && (
        <div className="run-band" style={{ marginTop: 'var(--s5)' }}>
          <div>
            <div className="step">What can I run?</div>
            <h2>Start from the machine you have.</h2>
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
          {previewHardware && picks.length > 0 && (
          <div>
            <div className="section-head" style={{ marginBottom: 4 }}>
              <h2><span className="glyph g-system" aria-hidden="true" /> {previewHardware.label}</h2>
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
          )}
        </div>
        )}
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
