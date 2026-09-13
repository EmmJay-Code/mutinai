import { catalog, compatQueries, getDb } from '@mutinai/db';
import { CAPABILITIES } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, LicenseShort } from '@/components/ui';
import { CapabilityBars, Heat, MemoryScale, SystemsMeter } from '@/components/viz';
import { CAPABILITY_LABEL, formatContext, formatParams, humanize, numberParam, searchParam } from '@/lib/format';

export const metadata: Metadata = { title: 'Models' };

type SP = Promise<Record<string, string | string[] | undefined>>;

const QUICK: { label: string; key: string; value: string }[] = [
  { label: 'Coding', key: 'capability', value: 'code' },
  { label: 'Reasoning', key: 'capability', value: 'reasoning' },
  { label: 'Vision', key: 'capability', value: 'vision' },
  { label: 'Tool use', key: 'capability', value: 'tool_use' },
  { label: 'Under 12 GB', key: 'fits', value: '12' },
  { label: 'Under 24 GB', key: 'fits', value: '24' },
  { label: 'Open license', key: 'commercial', value: 'allowed' },
];

const PARAM_KEYS = ['q', 'family', 'developer', 'architecture', 'capability', 'commercial', 'min', 'max', 'fits', 'sort'] as const;

export default async function ModelsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = Object.fromEntries(PARAM_KEYS.flatMap((k) => (searchParam(sp, k) ? [[k, searchParam(sp, k)!]] : []))) as Record<string, string>;
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
    sort: (current.sort as catalog.ModelListFilters['sort']) ?? 'released',
  };
  const db = getDb();
  const [models, all, facets, profiles, summary] = await Promise.all([
    catalog.listModels(db, filters),
    catalog.listModels(db),
    catalog.listModelFacets(db),
    catalog.listCapabilityProfiles(db),
    compatQueries.compatSummaryByModel(db, { contextLength: 8192 }),
  ]);
  const newest = all.map((m) => m.releasedOn).filter(Boolean).sort().at(-1);
  const isFresh = (d: string | null) => !!(d && newest && (new Date(newest).getTime() - new Date(d).getTime()) / 86_400_000 <= 45);

  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams({ ...current });
    for (const [k, v] of Object.entries(changes)) (v == null ? next.delete(k) : next.set(k, v));
    const s = next.toString();
    return s ? `/models?${s}` : '/models';
  };
  const labelFor = (k: string, v: string) =>
    k === 'family' ? facets.families.find((f) => f.slug === v)?.name ?? v
      : k === 'developer' ? facets.developers.find((d) => d.slug === v)?.name ?? v
        : k === 'capability' ? CAPABILITY_LABEL[v] ?? v
          : k === 'fits' ? `Under ${v} GB`
            : k === 'commercial' ? (v === 'allowed' ? 'Open license' : 'Restricted license')
              : k === 'architecture' ? (v === 'moe' ? 'Mixture of experts' : 'Dense')
                : k === 'min' ? `≥ ${v}B params` : k === 'max' ? `≤ ${v}B params` : v;
  const activeFilters = Object.entries(current).filter(([k]) => k !== 'sort' && k !== 'q');
  const advancedActive = ['family', 'developer', 'architecture', 'min', 'max'].some((k) => current[k]);

  return (
    <>
      <div className="dir-head">
        <h1><span className="glyph g-model" aria-hidden="true" /> Models</h1>
        <span className="count" aria-live="polite">{models.length} of {all.length}{filters.q ? ` matching “${filters.q}”` : ''}</span>
        <form className="dir-search" action="/models" role="search">
          {Object.entries(current).filter(([k]) => k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="sr-only" htmlFor="model-q">Search models</label>
          <input id="model-q" type="search" name="q" defaultValue={filters.q} placeholder="Search name, family, developer…" />
          <button type="submit">Search</button>
        </form>
      </div>

      <div className="dir-bar">
        <div className="chips" aria-label="Quick filters">
          {QUICK.map((q) => {
            const on = current[q.key] === q.value;
            return <Link key={q.label} className="chip" aria-pressed={on} href={href({ [q.key]: on ? null : q.value })}>{q.label}</Link>;
          })}
        </div>
        <details className="filter-panel" open={advancedActive}>
          <summary className="chip">More filters</summary>
          <form action="/models" className="filter-body">
            {filters.q && <input type="hidden" name="q" value={filters.q} />}
            {filters.sort && <input type="hidden" name="sort" value={filters.sort} />}
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
              <select name="commercial" defaultValue={filters.commercialUse ?? ''}><option value="">Any</option><option value="allowed">Open (commercial use)</option><option value="restricted">Restricted</option></select>
            </label>
            <label className="field"><span>Fits in memory (GB)</span><input type="number" name="fits" min="1" step="any" defaultValue={filters.fitsInGb} /></label>
            <label className="field"><span>Min parameters (B)</span><input type="number" name="min" min="0" step="any" defaultValue={filters.minParamsB} /></label>
            <label className="field"><span>Max parameters (B)</span><input type="number" name="max" min="0" step="any" defaultValue={filters.maxParamsB} /></label>
            <div className="tags"><button className="btn btn-primary" type="submit">Apply</button><Link className="btn" href="/models">Reset</Link></div>
          </form>
        </details>
        <span className="spacer" />
        <form action="/models" className="tags">
          {Object.entries(current).filter(([k]) => k !== 'sort').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="small muted" htmlFor="sort">Sort</label>
          <select id="sort" name="sort" defaultValue={filters.sort}>
            <option value="released">Newest</option>
            <option value="activity">Community activity</option>
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
          <Link className="small muted" href={filters.q ? `/models?q=${encodeURIComponent(filters.q)}` : '/models'}>Clear all</Link>
        </div>
      )}

      {models.length === 0 ? (
        <Empty>No models match. <Link className="link" href="/models">Clear all filters</Link>.</Empty>
      ) : (
        <form action="/models/compare">
          <div className="index-head models-grid" aria-hidden="true">
            <span /><span>Model</span><span title="Coding · Reasoning · Knowledge · Instruction following, relative to the best open result">Capability C·R·K·I</span><span>Memory to run</span><span>Runs well on</span><span>License</span><span>Activity</span>
          </div>
          <ul className="list-plain">
            {models.map((m) => {
              const commercial = m.licenses.some((l) => l.commercialUse === 'allowed') ? 'allowed' : m.licenses[0]?.commercialUse;
              const s = summary[m.slug];
              const activity = m.reviewCount + m.runCount;
              return (
                <li className="index-row models-grid" key={m.slug} style={{ borderTop: 0 }}>
                  <span className="glyph g-model" aria-hidden="true" />
                  <div>
                    <div className="name"><Link href={`/models/${m.slug}`}>{m.name}</Link>{isFresh(m.releasedOn) && <span className="new-badge">new</span>}</div>
                    <div className="sub">{m.developerName} · {formatParams(m.paramsTotal)}{m.paramsActive ? ` (${formatParams(m.paramsActive)} active)` : ''} · {formatContext(m.contextLength)} ctx · {m.releasedOn?.slice(0, 7) ?? ''}</div>
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
