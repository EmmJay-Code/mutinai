import { catalog, compatQueries, getDb } from '@mutinai/db';
import { CAPABILITIES, communityPhrase, describeModel, licenseOpenness, memoryPhrase, MODEL_INTENTS, modelIntent, OPENNESS_TEXT, profileMean, reachPhrase, type CapabilityProfile } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PathIcon } from '@/components/icons';
import { InfoModeToggle } from '@/components/info-mode';
import { Empty, LicenseShort } from '@/components/ui';
import { CapabilityBars, Heat, MemoryScale, SystemsMeter } from '@/components/viz';
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
  const advancedActive = ['family', 'developer', 'architecture', 'min', 'max', 'fits', 'capability', 'commercial'].some((k) => current[k]);
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
  recommended.slice(0, 2).forEach((m) => pick(m, 'Worth starting with', (x) => [memoryPhrase(x.minMemoryGb)?.amount, OPENNESS_TEXT[licenseOpenness(x.licenses)].label].filter(Boolean).join(' · ')));
  pick(popular.find((m) => !taken(m)), 'Popular', (x) => communityPhrase(x.runCount, x.reviewCount) ?? '');
  pick(latest.find((m) => !taken(m)), 'Right now', (x) => `Released ${formatMonthYear(x.releasedOn)} · ${x.developerName}`);

  return (
    <>
      <div className="dir-head">
        <h1><span className="glyph g-model" aria-hidden="true" /> Models</h1>
        <span className="count">{all.length} open-weight models and what they need to run</span>
        <form className="dir-search" action="/models" role="search">
          {Object.entries(current).filter(([k]) => k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="sr-only" htmlFor="model-q">Search models</label>
          <input id="model-q" type="search" name="q" defaultValue={filters.q} placeholder="Search name, family, developer…" />
          <button type="submit">Search</button>
        </form>
      </div>

      {simple && exploring && (
        <div className="discovery">
          <section className="intents" aria-labelledby="intents-h">
            <div className="intents-head">
              <h2 id="intents-h">What are you looking for?</h2>
              <a className="small muted" href="#all-models">Skip to all models ↓</a>
            </div>
            <ul className="intent-grid">
              {MODEL_INTENTS.map((i) => (
                <li key={i.key}>
                  <Link className="intent" href={intentHref(i.key)}>
                    <PathIcon name={i.key} />
                    <strong>{i.label}</strong>
                    <span className="hint">{i.hint}</span>
                    <span className="n" aria-label={`${all.filter(i.test).length} models`}>{all.filter(i.test).length}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          {picks.length > 0 && (
            <section className="starts" aria-labelledby="starts-h">
              <h2 id="starts-h" className="starts-title">Good places to start</h2>
              <ul className="starts-list">
                {picks.map((p) => (
                  <li key={p.m.slug}>
                    <span className="starts-tag">{p.tag}</span>
                    <Link className="starts-name" href={`/models/${p.m.slug}`}>{p.m.name}</Link>
                    <span className="starts-why">{p.why}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <div className={`catalog-head${simple && exploring ? ' after-discovery' : ''}`} id="all-models">
        <h2>
          {intent ? <><PathIcon name={intent.key} /> {intent.label}</> : 'All models'}
          <span className="count" aria-live="polite">{shown.length} of {all.length}{filters.q ? ` matching “${filters.q}”` : ''}</span>
        </h2>
        <InfoModeToggle mode={mode} returnTo={returnTo} />
      </div>
      {intent && (
        <p className="intent-explain">
          <span>{intent.explain}</span>
          <Link className="link" href={href({ for: null, sort: null })}>Show all models</Link>
        </p>
      )}

      <div className="dir-bar">
        {!(simple && exploring) && (
          <div className="chips" aria-label="Looking for">
            {MODEL_INTENTS.map((i) => (
              <Link key={i.key} className="chip" aria-pressed={current.for === i.key} href={intentHref(i.key)}>{i.label}</Link>
            ))}
          </div>
        )}
        <details className="filter-panel" open={advancedActive && !simple}>
          <summary className="chip">{simple ? 'Filters' : 'More filters'}</summary>
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
        <span className="spacer" />
        <form action="/models" className="tags">
          {Object.entries(current).filter(([k]) => k !== 'sort').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="small muted" htmlFor="sort">Sort</label>
          <select id="sort" name="sort" defaultValue={current.sort ?? (intent ? 'recommended' : 'released')}>
            {intent && <option value="recommended">Best match</option>}
            <option value="released">Newest</option>
            {!hideCommunity && <option value="activity">Community activity</option>}
            <option value="params_desc">Largest</option>
            <option value="params_asc">Smallest</option>
            <option value="name">Name</option>
          </select>
          <button className="btn btn-small" type="submit">Sort</button>
        </form>
      </div>
      {activeFilters.length > 0 && (
        <div className="active-filters" style={{ margin: '6px 0' }}>
          {activeFilters.map(([k, v]) => <Link key={k} className="tag" href={href({ [k]: null })} aria-label={`Remove filter ${labelFor(k, v)}`}>{labelFor(k, v)} ×</Link>)}
          <Link className="small muted" href={href(Object.fromEntries(activeFilters.map(([k]) => [k, null])))}>Clear filters</Link>
        </div>
      )}

      {shown.length === 0 ? (
        <Empty>No models match. <Link className="link" href="/models#all-models">Clear all filters</Link>.</Empty>
      ) : simple ? (
        <>
          <ul className="simple-list">
            {shown.map((m) => <SimpleModelRow key={m.slug} m={m} profile={profiles[m.slug]} reach={summary[m.slug]} fresh={isFresh(m.releasedOn)} />)}
          </ul>
          <p className="small muted mode-hint">Parameters, context length, capability profiles and side-by-side comparison are in the <strong>Technical</strong> view.</p>
        </>
      ) : (
        <form action="/models/compare">
          <div className="index-head models-grid" aria-hidden="true">
            <span /><span>Model</span><span title="Coding · Reasoning · Knowledge · Instruction following, relative to the best open result">Capability C·R·K·I</span><span>Memory to run</span><span>Runs well on</span><span>License</span><span>Activity</span>
          </div>
          <ul className="list-plain">
            {shown.map((m) => {
              const commercial = m.licenses.some((l) => l.commercialUse === 'allowed') ? 'allowed' : m.licenses[0]?.commercialUse;
              const s = summary[m.slug];
              const activity = m.reviewCount + m.runCount;
              return (
                <li className="index-row models-grid" key={m.slug} style={{ borderTop: 0 }}>
                  <span className="glyph g-model" aria-hidden="true" />
                  <div>
                    <div className="name"><Link href={`/models/${m.slug}`}>{m.name}</Link>{isFresh(m.releasedOn) && <span className="new-badge">new</span>}</div>
                    <div className="sub">{m.developerName} · <span className="num">{formatParams(m.paramsTotal)}{m.paramsActive ? ` (${formatParams(m.paramsActive)} active)` : ''}</span> · {m.architecture === 'moe' ? 'MoE' : 'Dense'} · <span className="num">{formatContext(m.contextLength)}</span> ctx · {m.releasedOn?.slice(0, 7) ?? ''}</div>
                    <div className="desc">
                      {m.capabilities.filter((c) => !['chat', 'multilingual'].includes(c)).map((c) => CAPABILITY_LABEL[c] ?? humanize(c)).join(' · ') || 'General chat'}
                      {' '}
                      <label className="compare-check" style={{ marginLeft: 8 }}><input type="checkbox" name="m" value={m.slug} /> Compare</label>
                    </div>
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
            <span>Tick “Compare” on two to four models to see them side by side.</span>
            <button className="btn btn-small" type="submit">Compare selected</button>
          </div>
        </form>
      )}
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
  return (
    <li className="simple-row">
      <div>
        <h3 className="name"><Link href={`/models/${m.slug}`}>{m.name}</Link>{fresh && <span className="new-badge">new</span>}</h3>
        <p className="simple-desc">{d.summary}{d.strength && <> <strong>{d.strength}</strong></>}</p>
        <div className="by">{m.developerName}</div>
      </div>
      <ul className="facts-plain">
        {mem && <li className="t-mem"><span><b>{mem.amount}</b> <span className="soft">· {mem.fits}</span></span></li>}
        {r && <li className={`t-${r.tone}`}><span>{r.text}</span></li>}
        <li className={`t-lic-${openness}`}><span title={m.licenses.map((l) => l.name).join('; ')}>{OPENNESS_TEXT[openness].label} <span className="soft">· {OPENNESS_TEXT[openness].detail}</span></span></li>
        {community && <li className="t-community"><span>{community}</span></li>}
      </ul>
      <Link className="simple-go" href={`/models/${m.slug}`} aria-label={`View ${m.name}`}>View model →</Link>
    </li>
  );
}
