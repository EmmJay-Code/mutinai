import { catalog, compatQueries, getDb } from '@mutinai/db';
import { CAPABILITIES, communityPhrase, describeModel, licenseOpenness, MEMORY_TIERS, memoryPhrase, MODEL_INTENTS, modelIntent, modelMemoryTier, OPENNESS_TEXT, profileMean, reachPhrase, type CapabilityProfile } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoSubmitSelect } from '@/components/auto-submit';
import { PathIcon } from '@/components/icons';
import { EdSection, Group, Masthead, Meter, StartStrip } from '@/components/editorial';
import { InfoModeToggle } from '@/components/info-mode';
import { Empty, LicenseShort } from '@/components/ui';
import { CapabilityBars, EstimateTag, Heat, MemoryScale, SystemsMeter } from '@/components/viz';
import { CAPABILITY_LABEL, formatContext, formatMonthYear, formatParams, humanize, numberParam, searchParam } from '@/lib/format';
import { hideSampleCommunityContent, measurementPolicy } from '@/lib/community-visibility';
import { getInfoMode } from '@/lib/info-mode';

export const metadata: Metadata = { title: 'Models' };

type SP = Promise<Record<string, string | string[] | undefined>>;
type Model = catalog.ModelListItemDTO;
type Reach = compatQueries.ModelCompatSummary | undefined;

const PARAM_KEYS = ['q', 'for', 'family', 'developer', 'architecture', 'capability', 'commercial', 'min', 'max', 'fits', 'sort'] as const;

export default async function ModelsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = Object.fromEntries(PARAM_KEYS.flatMap((k) => (searchParam(sp, k) ? [[k, searchParam(sp, k)!]] : []))) as Record<string, string>;
  const intent = modelIntent(current.for);
  if (!intent) delete current.for;
  const explicitSort = current.sort && current.sort !== 'recommended' ? (current.sort as catalog.ModelListFilters['sort']) : undefined;
  const filters: catalog.ModelListFilters = {
    q: current.q,
    family: current.family,
    developer: current.developer,
    architecture: current.architecture as 'dense' | 'moe' | undefined,
    capability: current.capability,
    commercialUse: current.commercial as 'allowed' | 'restricted' | undefined,
    minParamsB: numberParam(sp, 'min'),
    maxParamsB: numberParam(sp, 'max'),
    fitsInGb: numberParam(sp, 'fits'),
    sort: explicitSort ?? 'released',
  };
  const db = getDb();
  const [rawModels, rawAll, facets, profiles, summary, mode] = await Promise.all([
    catalog.listModels(db, filters),
    catalog.listModels(db),
    catalog.listModelFacets(db),
    catalog.listCapabilityProfiles(db),
    compatQueries.compatSummaryByModel(db, { contextLength: 8192, ...measurementPolicy() }),
    getInfoMode(),
  ]);
  // Counts of member runs and reviews are claims about a real model, so where the only contributions are seeded they
  // are zeroed here rather than filtered at each use: "Popular", the activity column and the community line all read
  // from these two fields. See lib/community-visibility.
  const hideCommunity = hideSampleCommunityContent();
  const scrub = (list: Model[]) => (hideCommunity ? list.map((m) => ({ ...m, runCount: 0, reviewCount: 0 })) : list);
  const models = scrub(rawModels);
  const all = scrub(rawAll);
  const ctx = (m: Model) => ({ profile: profiles[m.slug], reach: summary[m.slug] });
  let shown = intent ? models.filter(intent.test) : models;
  if (intent && !explicitSort) shown = [...shown].sort((a, b) => intent.score(b, ctx(b)) - intent.score(a, ctx(a)));

  const newest = all.map((m) => m.releasedOn).filter(Boolean).sort().at(-1);
  const isFresh = (d: string | null) => !!(d && newest && (new Date(newest).getTime() - new Date(d).getTime()) / 86_400_000 <= 45);

  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams({ ...current });
    for (const [k, v] of Object.entries(changes)) (v == null ? next.delete(k) : next.set(k, v));
    const s = next.toString();
    return s ? `/models?${s}` : '/models';
  };
  const intentHref = (key: string) => (current.for === key ? href({ for: null }) : href({ for: key, sort: null }));
  const query = new URLSearchParams(current).toString();
  const returnTo = `/models${query ? `?${query}` : ''}#all-models`;
  const labelFor = (k: string, v: string) =>
    k === 'family' ? facets.families.find((f) => f.slug === v)?.name ?? v
      : k === 'developer' ? facets.developers.find((d) => d.slug === v)?.name ?? v
        : k === 'capability' ? CAPABILITY_LABEL[v] ?? v
          : k === 'fits' ? `Under ${v} GB`
            : k === 'commercial' ? (v === 'allowed' ? 'Permissive license' : 'Restricted license')
              : k === 'architecture' ? (v === 'moe' ? 'Mixture of experts' : 'Dense')
                : k === 'min' ? `≥ ${v}B params` : k === 'max' ? `≤ ${v}B params` : v;
  const activeFilters = Object.entries(current).filter(([k]) => !['sort', 'q', 'for'].includes(k));
  const advancedCount = ['family', 'developer', 'architecture', 'min', 'max', 'fits', 'capability', 'commercial'].filter((k) => current[k]).length;
  const exploring = activeFilters.length === 0 && !filters.q && !intent;
  const simple = mode === 'simple';

  // Candidate pools for the orientation strip below: starting points, most discussed, newest.
  const recommended = all
    .filter((m) => { const s = summary[m.slug]; return !!s?.of && s.runsWell / s.of >= 0.5; })
    .sort((a, b) => profileMean(profiles[b.slug]) - profileMean(profiles[a.slug]) || b.paramsTotal - a.paramsTotal)
    .slice(0, 3);
  const popular = all.filter((m) => m.reviewCount + m.runCount > 0).sort((a, b) => b.reviewCount + b.runCount - (a.reviewCount + a.runCount)).slice(0, 3);
  const latest = all.filter((m) => m.releasedOn).sort((a, b) => b.releasedOn!.localeCompare(a.releasedOn!) || b.paramsTotal - a.paramsTotal).slice(0, 3);
  // One orientation strip, not a second catalog: two starting points, the most discussed and the newest, without repeats.
  const picks: { m: Model; tag: string; why: string }[] = [];
  const taken = (m: Model) => picks.some((p) => p.m.slug === m.slug);
  const pick = (m: Model | undefined, tag: string, why: (m: Model) => string) => { if (m && !taken(m)) picks.push({ m, tag, why: why(m) }); };
  recommended.slice(0, 2).forEach((m) => pick(m, 'Worth starting with', (x) => [memoryPhrase(x.minMemoryGb) && `${memoryPhrase(x.minMemoryGb)!.amount} (estimate)`, OPENNESS_TEXT[licenseOpenness(x.licenses)].label].filter(Boolean).join(' · ')));
  pick(popular.find((m) => !taken(m)), 'Popular', (x) => communityPhrase(x.runCount, x.reviewCount) ?? '');
  pick(latest.find((m) => !taken(m)), 'Right now', (x) => `Released ${formatMonthYear(x.releasedOn)} · ${x.developerName}`);

  const groups = [
    ...MEMORY_TIERS.map((t, i) => ({ id: `needs-${t.key}`, tier: t, level: i + 1, models: shown.filter((m) => modelMemoryTier(m.minMemoryGb)?.key === t.key) })),
    { id: 'needs-unknown', tier: null, level: 0, models: shown.filter((m) => m.minMemoryGb == null) },
  ].filter((g) => g.models.length > 0);

  return (
    <>
      <Masthead
        eyebrow={`Models · ${all.length} tracked`}
        title="Pick a model by what you have and what you want it for."
        lede="Every model here can be downloaded and run on your own hardware. The number that matters most is the memory it needs, so the list is grouped by it."
      >
        {exploring && <StartStrip items={picks.map((p) => ({ href: `/models/${p.m.slug}`, tag: p.tag, name: p.m.name, why: p.why }))} />}
      </Masthead>

      <EdSection
        id="all-models"
        title={<>{intent ? <><PathIcon name={intent.key} /> {intent.label}</> : simple ? 'Every model, by what it needs to run' : 'All models'}<span className="count" aria-live="polite">{shown.length} of {all.length}{filters.q ? ` matching “${filters.q}”` : ''}</span></>}
        intro={intent
          ? <>{intent.explain} <Link className="link" href={href({ for: null, sort: null })}>Show all models</Link></>
          : simple ? 'Memory at 4-bit, the usual way people run models locally, with room for a working conversation.' : undefined}
        tools={<InfoModeToggle mode={mode} returnTo={returnTo} />}
      >
      {/* Controls by role: find (search, filters, sort) on one line, then the "looking for" presets, then what is
          applied. Navigation within the results (jump to a group) sits with the results, as text links. */}
      <div className="catalog-bar">
        <div className="bar-row">
          <form className="bar-search" action="/models#all-models" role="search">
            {Object.entries(current).filter(([k]) => k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label className="sr-only" htmlFor="model-q">Search models</label>
            <input id="model-q" type="search" name="q" defaultValue={filters.q} placeholder="Search name, family, developer…" />
          </form>
          <details className="filter-panel">
            <summary className="bar-btn" aria-pressed={advancedCount > 0}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M2 4h12M4.5 8h7M7 12h2" /></svg>
              Filters{advancedCount > 0 && <span className="bar-count">{advancedCount}</span>}
            </summary>
            <form action="/models" className="filter-body">
              {filters.q && <input type="hidden" name="q" value={filters.q} />}
              {intent && <input type="hidden" name="for" value={intent.key} />}
              {current.sort && <input type="hidden" name="sort" value={current.sort} />}
              <label className="field"><span>Family</span>
                <select name="family" defaultValue={filters.family ?? ''}><option value="">Any</option>{facets.families.map((f) => <option key={f.slug} value={f.slug}>{f.parentSlug ? `— ${f.name}` : f.name}</option>)}</select>
              </label>
              <label className="field"><span>Developer</span>
                <select name="developer" defaultValue={filters.developer ?? ''}><option value="">Any</option>{facets.developers.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}</select>
              </label>
              <label className="field"><span>Capability</span>
                <select name="capability" defaultValue={filters.capability ?? ''}><option value="">Any</option>{CAPABILITIES.map((c) => <option key={c} value={c}>{CAPABILITY_LABEL[c] ?? humanize(c)}</option>)}</select>
              </label>
              <label className="field"><span>Architecture</span>
                <select name="architecture" defaultValue={filters.architecture ?? ''}><option value="">Any</option><option value="dense">Dense</option><option value="moe">Mixture of experts</option></select>
              </label>
              <label className="field"><span>License</span>
                <select name="commercial" defaultValue={filters.commercialUse ?? ''}><option value="">Any</option><option value="allowed">Permissive (commercial use allowed)</option><option value="restricted">Restricted</option></select>
              </label>
              <label className="field"><span>Fits in memory (GB)</span><input type="number" name="fits" min="1" step="any" defaultValue={filters.fitsInGb} /></label>
              <label className="field"><span>Min parameters (B)</span><input type="number" name="min" min="0" step="any" defaultValue={filters.minParamsB} /></label>
              <label className="field"><span>Max parameters (B)</span><input type="number" name="max" min="0" step="any" defaultValue={filters.maxParamsB} /></label>
              <div className="tags"><button className="btn btn-primary" type="submit">Apply</button><Link className="btn" href="/models#all-models">Reset</Link></div>
            </form>
          </details>
          <form action="/models#all-models" className="bar-sort">
            {Object.entries(current).filter(([k]) => k !== 'sort').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label htmlFor="sort">Sort</label>
            <AutoSubmitSelect id="sort" name="sort" defaultValue={current.sort ?? (intent ? 'recommended' : 'released')}>
              {intent && <option value="recommended">Best match</option>}
              <option value="released">Newest</option>
              {!hideCommunity && <option value="activity">Community activity</option>}
              <option value="params_desc">Largest</option>
              <option value="params_asc">Smallest</option>
              <option value="name">Name</option>
            </AutoSubmitSelect>
            <noscript><button className="btn btn-small" type="submit">Sort</button></noscript>
          </form>
        </div>
        <div className="bar-row">
          <span className="bar-label" id="looking-for">Looking for</span>
          <div className="chips" aria-labelledby="looking-for">
            {MODEL_INTENTS.map((i) => (
              <Link key={i.key} className="chip" aria-pressed={current.for === i.key} href={intentHref(i.key)} title={i.hint}>{i.label}</Link>
            ))}
          </div>
        </div>
        {activeFilters.length > 0 && (
          <div className="bar-row active-filters">
            <span className="bar-label">Applied</span>
            {activeFilters.map(([k, v]) => <Link key={k} className="tag" href={href({ [k]: null })} aria-label={`Remove filter ${labelFor(k, v)}`}>{labelFor(k, v)} ×</Link>)}
            <Link className="small link" href={href(Object.fromEntries(activeFilters.map(([k]) => [k, null])))}>Clear all</Link>
          </div>
        )}
      </div>
      {simple && groups.length > 1 && (
        <nav className="jump-text" aria-label="Jump to group">
          <span className="bar-label">Jump to</span>
          {groups.map((g) => <a key={g.id} href={`#${g.id}`}>{g.tier?.short ?? 'Not recorded'}</a>)}
        </nav>
      )}

      {shown.length === 0 ? (
        <Empty>No models match. <Link className="link" href="/models#all-models">Clear all filters</Link>.</Empty>
      ) : simple ? (
        <>
          {groups.map((g) => (
            <Group
              key={g.id}
              id={g.id}
              top={g.tier ? <Meter level={g.level} of={MEMORY_TIERS.length} /> : undefined}
              title={g.tier?.label ?? 'Memory not recorded yet'}
              range={g.tier?.range}
              hint={g.tier?.alsoRuns ?? 'No download with a known size is on file, so what these need is not estimated.'}
            >
              <div className="rows-head rows-models" aria-hidden="true"><span>Model</span><span className="r">Memory</span><span className="r">License</span></div>
              <ul className="rows">
                {g.models.map((m) => <SimpleModelRow key={m.slug} m={m} profile={profiles[m.slug]} reach={summary[m.slug]} fresh={isFresh(m.releasedOn)} />)}
              </ul>
            </Group>
          ))}
          <p className="small muted mode-hint">Parameters, context length, capability profiles and side-by-side comparison are in the <strong>Technical</strong> view.</p>
        </>
      ) : (
        <form action="/models/compare">
          <div className="index-head models-grid" aria-hidden="true">
            <span className="compare-col">Compare</span><span>Model</span><span title="Coding · Reasoning · Knowledge · Instruction following, relative to the best open result">Capability C·R·K·I</span><span>Memory to run</span><span>Runs well on</span><span>License</span><span>Activity</span>
          </div>
          <ul className="list-plain">
            {shown.map((m) => {
              const commercial = m.licenses.some((l) => l.commercialUse === 'allowed') ? 'allowed' : m.licenses[0]?.commercialUse;
              const s = summary[m.slug];
              const activity = m.reviewCount + m.runCount;
              return (
                <li className="index-row models-grid" key={m.slug}>
                  <label className="compare-cell"><input type="checkbox" name="m" value={m.slug} aria-label={`Compare ${m.name}`} /></label>
                  <div>
                    <div className="name"><Link href={`/models/${m.slug}`}>{m.name}</Link>{isFresh(m.releasedOn) && <span className="new-badge">new</span>}</div>
                    <div className="sub">{m.developerName} · <span className="num">{formatParams(m.paramsTotal)}{m.paramsActive ? ` (${formatParams(m.paramsActive)} active)` : ''}</span> · {m.architecture === 'moe' ? 'MoE' : 'Dense'} · <span className="num">{formatContext(m.contextLength)}</span> ctx · {m.releasedOn?.slice(0, 7) ?? ''}</div>
                    <div className="desc">{m.capabilities.filter((c) => !['chat', 'multilingual'].includes(c)).map((c) => CAPABILITY_LABEL[c] ?? humanize(c)).join(' · ') || 'General chat'}</div>
                  </div>
                  <div><span className="cell-label">Capability</span><CapabilityBars profile={profiles[m.slug]} /></div>
                  <div><span className="cell-label">Memory to run</span><MemoryScale gb={m.minMemoryGb} label="from" /></div>
                  <div><span className="cell-label">Runs well on</span>{s ? <SystemsMeter runsWell={s.runsWell} slow={s.slow} of={s.of} /> : <span className="faint">—</span>}</div>
                  <div><span className="cell-label">License</span><LicenseShort commercialUse={commercial} name={m.licenses.map((l) => l.name).join('; ')} /></div>
                  <div>
                    <span className="cell-label">Activity</span>
                    <Heat level={Math.min(3, activity)} label={`${m.runCount} runs, ${m.reviewCount} reviews`} />
                    <span className="small muted" style={{ marginLeft: 6 }}>{activity || ''}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="compare-bar">
            <span className="compare-none">Tick the box beside two to four models to compare them side by side.</span>
            <span className="compare-some" aria-hidden="true" />
            <button className="btn btn-small" type="submit">Compare</button>
          </div>
        </form>
      )}
      </EdSection>
    </>
  );
}

/** Decision-relevant statements in plain language. Same data as the technical row, no glyphs to decode. */
function SimpleModelRow({ m, profile, reach, fresh }: { m: Model; profile: CapabilityProfile | undefined; reach: Reach; fresh: boolean }) {
  const d = describeModel(m, profile);
  const mem = memoryPhrase(m.minMemoryGb);
  const r = reachPhrase(reach);
  const openness = licenseOpenness(m.licenses);
  const community = communityPhrase(m.runCount, m.reviewCount);
  const details = [r?.text, community].filter(Boolean).join(' · ');
  return (
    <li className="rows-models">
      <div>
        <div className="name"><Link href={`/models/${m.slug}`}>{m.name}</Link>{fresh && <span className="new-badge">new</span>}</div>
        <span className="desc">{d.summary}{d.strength && <> {d.strength}</>}</span>
        <span className="sub">{m.developerName}{details ? ` · ${details}` : ''}</span>
      </div>
      <span className="val r">{mem ? <>{mem.amount.replace(' to run', '')} <EstimateTag /><small>to run</small></> : '—'}</span>
      <span className="r" title={`${OPENNESS_TEXT[openness].detail}. ${m.licenses.map((l) => l.name).join('; ')}`}><LicenseShort commercialUse={openness === 'permissive' ? 'allowed' : openness === 'noncommercial' ? 'prohibited' : openness === 'restricted' ? 'restricted' : null} /></span>
    </li>
  );
}
