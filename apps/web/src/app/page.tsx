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
import { EdSection } from '@/components/editorial';
import { Basis, EntityLink, Explain, LicenseShort, OriginBasis, Placeholder } from '@/components/ui';
import { Avatar, CapabilityBars, EntityMark, Heat, MemoryScale, MonthlyBars, SystemsMeter } from '@/components/viz';
import { entityTypeOfEvent, EVENT_GROUPS } from '@/lib/events';
import { measurementPolicy } from '@/lib/community-visibility';
import { entityHref, formatDate, formatNumber, formatParams, humanize, isoDate } from '@/lib/format';
import { bestDevicePrice, maxParamsAtQ4, roughParams } from '@/lib/hardware';
import { communityContentIsSample } from '@/lib/session';

/** Why anyone would run models themselves. Product statements, not data claims; each opens the surface that proves it. */
const OPEN_VALUE = [
  { title: 'Your data stays put', text: 'Prompts, code and documents stay on the machine you ran them on.', href: '/learn#run-locally', label: 'How local models work' },
  { title: 'No account, no per-token bill', text: 'Download the weights once and run them on a laptop, one graphics card, a Mac or a server.', href: '/run', label: 'What can I run?' },
  { title: 'Nobody can take it back', text: 'The weights are files you keep. Nobody can withdraw, reprice or quietly change them.', href: '/learn#start-here', label: 'What “open” means' },
];

/** Entry points phrased the way newcomers ask; each lands on a filtered, explained view. */
const QUESTIONS = [
  { href: '/search?q=like%20chatgpt', label: 'Something like ChatGPT, on my computer?' },
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
  const [events, observations, liveStatus, frontier, models, stats, submissions, reviews, profiles, summary, devices, counts, bestScores, observedPrices] = await Promise.all([
    catalog.listEvents(db, { limit: 1000 }),
    catalog.listMetricObservations(db, { since: new Date(now.getTime() - (FRESHNESS.trendingDays + FRESHNESS.trendingBaselineMaxDays + 1) * DAY), metrics: TRENDING_METRICS }),
    catalog.liveSourceStatus(db),
    catalog.benchmarkFrontier(db, 'gpqa-diamond'),
    catalog.listModels(db),
    community.getCommunityStats(db),
    community.listSubmissions(db, {}, undefined, 40),
    community.listRecentReviews(db, undefined, 10),
    catalog.listCapabilityProfiles(db),
    compatQueries.compatSummaryByModel(db, { contextLength: 8192, ...measurementPolicy() }),
    catalog.listDevices(db, { sort: 'memory' }),
    catalog.getCatalogCounts(db),
    catalog.listBenchmarkScores(db),
    catalog.listLatestDevicePrices(db),
  ]);

  const best = frontier?.points.at(-1);

  // Reading order: why open models (with ways in) → what changed → families → benchmarks → hardware → what members report.
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

  // Where no one can sign in, every community row came from the seed, and the seed's accounts and content are
  // fictional. Sample content must never read as member activity on a public page, so the section shows none of it
  // and says why instead. See `communityContentIsSample`.
  const sampleCommunity = communityContentIsSample();
  const activeModels = sampleCommunity ? [] : models.filter((m) => m.reviewCount + m.runCount > 0).sort((a, b) => b.reviewCount + b.runCount - (a.reviewCount + a.runCount)).slice(0, 3);
  const featuredRuns = sampleCommunity ? [] : submissions.slice(0, 3);
  const featuredReviews = sampleCommunity ? [] : [...reviews].sort((a, b) => b.helpfulScore - a.helpfulScore).slice(0, 2);

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


  return (
    <>
      <section className="cover" aria-labelledby="hero-title">
        <div className="eyebrow">Open models · {mode === 'live' ? (liveStatus.lastCheckedAt ? `sources checked ${formatDate(liveStatus.lastCheckedAt)}` : 'live sources') : 'illustrative fixture data'}</div>
        <h1 id="hero-title">AI you can download, run and keep.</h1>
        <p className="lede">
          Open models are published as files anyone can download: you run them on your own hardware instead of sending your work to
          someone else’s. Mutinai tracks the models, the machines they fit and the tools that run them, and labels every figure with
          where it came from.
        </p>
        <div className="cover-actions">
          <Link className="btn btn-primary" href="/run">What can I run?</Link>
          <a className="text-link" href="#now">What’s happening right now</a>
        </div>
        <ul className="questions cover-questions" aria-label="Start with a question">
          {QUESTIONS.map((q) => <li key={q.href}><Link href={q.href}>{q.label}</Link></li>)}
        </ul>
        <ul className="statline" aria-label="The ecosystem at a glance">
          <li><b>{models.length}</b>open-weight models</li>
          <li><b>{recentReleaseCount}</b>releases &amp; launches in {FRESHNESS.recentDays} days</li>
          {best && <li>Best open GPQA Diamond <b style={{ marginLeft: 4 }}>{best.value.toFixed(1)}%</b>({best.name})</li>}
          {sampleCommunity
            ? <li><b>{counts.project ?? 0}</b>tools &amp; runtimes</li>
            : <li><b>{stats.verified}</b>verified community runs</li>}
        </ul>
      </section>

      <EdSection id="now" title="What’s happening right now" tools={<Link className="more" href="/new">Full timeline →</Link>}>
        {digest.some((d) => d.recentCount > 0) && (
          <ul className="kind-links" aria-label={`Tracked changes by part of the ecosystem, last ${FRESHNESS.recentDays} days`}>
            {EVENT_GROUPS.map((group) => {
              const d = digest.find((x) => x.key === group.key)!;
              if (!d.recentCount) return null;
              return (
                <li key={group.key}>
                  <Link href={`/new?kind=${group.key}`} title={d.latest ? `Latest: ${d.latest.title}` : undefined}>
                    <EntityMark type={group.type} /> <b>{d.recentCount}</b> {group.label.toLowerCase()} <span className="quiet">in {FRESHNESS.recentDays} days</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {lead && (
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
            {/* With no top story (only fixtures, or a quiet fortnight) the page opens on news, not on an empty block. */}
            {!lead && events.length > 0 && (
              <p className="small muted" style={{ marginTop: 'var(--s3)' }}>
                {mode === 'live'
                  ? `No top story: nothing major — a model release, hardware launch or new runtime version — in the last ${FRESHNESS.topStoryDays} days.`
                  : 'Only illustrative fixture data is loaded, so none of this is current news.'}
              </p>
            )}
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
      </EdSection>



      <EdSection
        id="families"
        title="Models worth knowing"
        intro="Open models arrive in families. Start with the family and who builds it, then open a release to see its sizes and variants."
        tools={<Link className="more" href="/models">All models →</Link>}
      >
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
      </EdSection>

      <EdSection
        id="benchmarks"
        title="How they compare"
        intro={<>A <Explain term="benchmark" /> is a fixed set of questions every model answers, so scores can be compared. Positions below are relative to the best open result Mutinai holds for that test.</>}
        tools={<Link className="more" href="/benchmarks">All benchmarks →</Link>}
      >
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
              <p className="bench-basis"><OriginBasis origins={leaders.map((s) => s.origin)} /> <Link className="link nowrap" href="/benchmarks">what it measures →</Link></p>
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
      </EdSection>

      <EdSection
        id="hardware"
        title="Hardware watch"
        intro="Memory decides what fits; memory speed decides how fast it answers. Prices are shown only with what they mean and when they were checked."
        tools={<Link className="more" href="/hardware">All hardware →</Link>}
      >

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

      </EdSection>


      <EdSection id="community" title="What the community is talking about" tools={<Link className="more" href="/community">All contributions →</Link>}>
        <div className="signal">
          <p className="signal-note">
            <Basis kind="community">Community</Basis>{' '}
            {sampleCommunity
              ? 'Runs and reviews written by members will appear here, kept separate from the sourced facts everywhere else on this page and never merged into them.'
              : 'Written and measured by members — kept separate from the sourced facts everywhere else on this page, and never merged into them.'}
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
            <Placeholder title={sampleCommunity ? 'Contributions are not open yet' : 'Nothing from the community yet'}>
              {sampleCommunity
                ? 'This preview has no sign-in, so nothing here could have been written by a member: the accounts, runs and reviews in its database are fictional sample content, and are left out rather than dressed up as activity. Real runs, reviews and discussion appear here once contributions open.'
                : 'Member runs and reviews appear here as soon as they are submitted. Mutinai shows no discussion, ratings or sentiment until real contributions exist — an empty section is more useful than an invented one.'}
            </Placeholder>
          )}
        </div>
      </EdSection>

      <EdSection id="why" title="Why run models yourself">
        <ul className="reasons">
          {OPEN_VALUE.map((v) => (
            <li key={v.title}>
              <h3>{v.title}</h3>
              <p>{v.text}</p>
              <Link href={v.href}>{v.label} →</Link>
            </li>
          ))}
        </ul>
      </EdSection>
    </>
  );
}
