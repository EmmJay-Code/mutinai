import { catalog, getDb } from '@mutinai/db';
import { CAPABILITIES } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, LicenseShort, Tag } from '@/components/ui';
import { CAPABILITY_LABEL, formatContext, formatParams, humanize, numberParam, searchParam } from '@/lib/format';

export const metadata: Metadata = { title: 'Models' };

type SP = Promise<Record<string, string | string[] | undefined>>;

const QUICK: { label: string; key: string; value: string }[] = [
  { label: 'Coding', key: 'capability', value: 'code' },
  { label: 'Reasoning', key: 'capability', value: 'reasoning' },
  { label: 'Vision', key: 'capability', value: 'vision' },
  { label: 'Tool use', key: 'capability', value: 'tool_use' },
  { label: 'Runs under 12 GB', key: 'fits', value: '12' },
  { label: 'Runs under 24 GB', key: 'fits', value: '24' },
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
  const [models, facets] = await Promise.all([catalog.listModels(db, filters), catalog.listModelFacets(db)]);

  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams({ ...current });
    for (const [k, v] of Object.entries(changes)) (v == null ? next.delete(k) : next.set(k, v));
    const s = next.toString();
    return s ? `/models?${s}` : '/models';
  };
  const advancedActive = ['family', 'developer', 'architecture', 'min', 'max'].some((k) => current[k]) || (current.commercial === 'restricted');
  const labelFor = (k: string, v: string) =>
    k === 'family' ? facets.families.find((f) => f.slug === v)?.name ?? v
      : k === 'developer' ? facets.developers.find((d) => d.slug === v)?.name ?? v
        : k === 'capability' ? CAPABILITY_LABEL[v] ?? v
          : k === 'fits' ? `Under ${v} GB`
            : k === 'commercial' ? (v === 'allowed' ? 'Open license' : 'Restricted license')
              : k === 'architecture' ? (v === 'moe' ? 'Mixture of experts' : 'Dense')
                : k === 'min' ? `≥ ${v}B params` : k === 'max' ? `≤ ${v}B params` : v;
  const activeFilters = Object.entries(current).filter(([k]) => k !== 'sort' && k !== 'q');

  return (
    <>
      <div className="discover-head">
        <div className="eyebrow">Models</div>
        <h1>Find the right open model.</h1>
        <form className="searchbar" action="/models" role="search">
          {Object.entries(current).filter(([k]) => k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="sr-only" htmlFor="model-q">Search models</label>
          <input id="model-q" type="search" name="q" defaultValue={filters.q} placeholder="Search by name, family or developer…" />
          <button className="btn btn-primary" type="submit">Search</button>
        </form>
        <div className="chips quick-filters" aria-label="Quick filters">
          {QUICK.map((q) => {
            const on = current[q.key] === q.value;
            return (
              <Link key={q.label} className="chip" aria-pressed={on} href={href({ [q.key]: on ? null : q.value })}>{q.label}</Link>
            );
          })}
        </div>
      </div>

      <div className="toolbar">
        <div className="count" aria-live="polite">
          {models.length} model{models.length === 1 ? '' : 's'}{filters.q ? <> matching “{filters.q}”</> : null}
          {activeFilters.length > 0 && (
            <span className="active-filters" style={{ display: 'inline-flex', marginLeft: 12 }}>
              {activeFilters.map(([k, v]) => (
                <Link key={k} className="tag" href={href({ [k]: null })} aria-label={`Remove filter ${labelFor(k, v)}`}>{labelFor(k, v)} ×</Link>
              ))}
              <Link className="small muted" href={filters.q ? `/models?q=${encodeURIComponent(filters.q)}` : '/models'}>Clear</Link>
            </span>
          )}
        </div>
        <div className="toolbar-actions">
          <form action="/models" className="tags">
            {Object.entries(current).filter(([k]) => k !== 'sort').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label className="small muted" htmlFor="sort">Sort</label>
            <select id="sort" name="sort" defaultValue={filters.sort}>
              <option value="released">Newest</option>
              <option value="activity">Most community activity</option>
              <option value="params_desc">Largest</option>
              <option value="params_asc">Smallest</option>
              <option value="name">Name</option>
            </select>
            <button className="btn btn-small" type="submit">Apply</button>
          </form>
        </div>
      </div>

      <details className="filter-panel" open={advancedActive}>
        <summary className="btn btn-small">Filters{advancedActive ? ' ·' : ''}</summary>
        <form action="/models" className="filter-body">
          {filters.q && <input type="hidden" name="q" value={filters.q} />}
          {filters.sort && <input type="hidden" name="sort" value={filters.sort} />}
          <label className="field">
            <span>Family</span>
            <select name="family" defaultValue={filters.family ?? ''}>
              <option value="">Any</option>
              {facets.families.map((f) => <option key={f.slug} value={f.slug}>{f.parentSlug ? `— ${f.name}` : f.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Developer</span>
            <select name="developer" defaultValue={filters.developer ?? ''}>
              <option value="">Any</option>
              {facets.developers.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Capability</span>
            <select name="capability" defaultValue={filters.capability ?? ''}>
              <option value="">Any</option>
              {CAPABILITIES.map((c) => <option key={c} value={c}>{CAPABILITY_LABEL[c] ?? humanize(c)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Architecture</span>
            <select name="architecture" defaultValue={filters.architecture ?? ''}>
              <option value="">Any</option>
              <option value="dense">Dense</option>
              <option value="moe">Mixture of experts</option>
            </select>
          </label>
          <label className="field">
            <span>License</span>
            <select name="commercial" defaultValue={filters.commercialUse ?? ''}>
              <option value="">Any</option>
              <option value="allowed">Open (commercial use allowed)</option>
              <option value="restricted">Restricted</option>
            </select>
          </label>
          <label className="field">
            <span>Fits in memory (GB)</span>
            <input type="number" name="fits" min="1" step="any" defaultValue={filters.fitsInGb} placeholder="e.g. 16" />
          </label>
          <label className="field">
            <span>Min parameters (B)</span>
            <input type="number" name="min" min="0" step="any" defaultValue={filters.minParamsB} />
          </label>
          <label className="field">
            <span>Max parameters (B)</span>
            <input type="number" name="max" min="0" step="any" defaultValue={filters.maxParamsB} />
          </label>
          <div className="tags">
            <button className="btn btn-primary" type="submit">Apply filters</button>
            <Link className="btn" href="/models">Reset</Link>
          </div>
        </form>
      </details>

      {models.length === 0 ? (
        <Empty>No models match. <Link href="/models">Clear all filters</Link>.</Empty>
      ) : (
        <form action="/models/compare">
          <ul className="result-list">
            {models.map((m) => {
              const commercial = m.licenses.some((l) => l.commercialUse === 'allowed') ? 'allowed' : m.licenses[0]?.commercialUse;
              return (
                <li className="result" key={m.slug}>
                  <div>
                    <h3><Link href={`/models/${m.slug}`}>{m.name}</Link></h3>
                    <div className="by">{m.developerName} · {m.familyName}{m.releasedOn ? ` · ${m.releasedOn.slice(0, 4)}` : ''}</div>
                    {m.summary && <p className="desc">{m.summary}</p>}
                    <div className="tags">
                      {m.capabilities.filter((c) => c !== 'chat' && c !== 'multilingual').slice(0, 4).map((c) => <Tag key={c}>{CAPABILITY_LABEL[c] ?? humanize(c)}</Tag>)}
                      {m.architecture === 'moe' && <Tag title="Mixture of experts: only part of the model is used per token, so it runs fast for its size">MoE</Tag>}
                    </div>
                    <div className="result-actions">
                      <Link href={`/models/${m.slug}`}>View model →</Link>
                      <label className="small muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input type="checkbox" name="m" value={m.slug} /> Compare
                      </label>
                    </div>
                  </div>
                  <div className="result-side">
                    <div>
                      <div className="big">{m.minMemoryGb != null ? `from ~${Math.ceil(m.minMemoryGb)} GB` : '—'}</div>
                      <div className="small muted">memory to run</div>
                    </div>
                    <div className="small">{formatParams(m.paramsTotal)} parameters{m.paramsActive ? ` (${formatParams(m.paramsActive)} active)` : ''} · {formatContext(m.contextLength)} context</div>
                    <div className="small"><LicenseShort commercialUse={commercial} /></div>
                    {m.reviewCount + m.runCount > 0 && (
                      <div className="small muted">{m.reviewCount} review{m.reviewCount === 1 ? '' : 's'} · {m.runCount} run{m.runCount === 1 ? '' : 's'}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="compare-bar">
            <span className="small">Tick “Compare” on two to four models</span>
            <button className="btn btn-small" type="submit">Compare selected</button>
          </div>
        </form>
      )}
    </>
  );
}
