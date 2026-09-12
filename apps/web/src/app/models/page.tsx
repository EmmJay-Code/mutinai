import { catalog, getDb } from '@mutinai/db';
import { CAPABILITIES } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, PageHead, Tag } from '@/components/ui';
import { formatBytes, formatContext, formatDate, formatParams, humanize, numberParam, searchParam } from '@/lib/format';

export const metadata: Metadata = { title: 'Models' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ModelsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filters: catalog.ModelListFilters = {
    q: searchParam(sp, 'q'),
    family: searchParam(sp, 'family'),
    developer: searchParam(sp, 'developer'),
    architecture: searchParam(sp, 'architecture') as 'dense' | 'moe' | undefined,
    capability: searchParam(sp, 'capability'),
    commercialUse: searchParam(sp, 'commercial') as 'allowed' | 'restricted' | undefined,
    minParamsB: numberParam(sp, 'min'),
    maxParamsB: numberParam(sp, 'max'),
    sort: (searchParam(sp, 'sort') as catalog.ModelListFilters['sort']) ?? 'released',
  };
  const db = getDb();
  const [models, facets] = await Promise.all([catalog.listModels(db, filters), catalog.listModelFacets(db)]);
  const active = Object.entries(filters).filter(([k, v]) => v != null && k !== 'sort').length;

  return (
    <>
      <PageHead
        eyebrow="Directory"
        title="Models"
        lede="Each row is a distinct trained model (architecture and size). Variants — base, instruct, reasoning, distills and community fine-tunes — and their quantizations are listed on the model page."
      />
      <form className="filters" action="/models">
        <label className="field">
          <span>Search</span>
          <input type="search" name="q" defaultValue={filters.q} placeholder="Name, variant, repo…" />
        </label>
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
          <span>Architecture</span>
          <select name="architecture" defaultValue={filters.architecture ?? ''}>
            <option value="">Any</option>
            <option value="dense">Dense</option>
            <option value="moe">Mixture of experts</option>
          </select>
        </label>
        <label className="field">
          <span>Capability</span>
          <select name="capability" defaultValue={filters.capability ?? ''}>
            <option value="">Any</option>
            {CAPABILITIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Commercial use</span>
          <select name="commercial" defaultValue={filters.commercialUse ?? ''}>
            <option value="">Any license</option>
            <option value="allowed">Permissive</option>
            <option value="restricted">Restricted</option>
          </select>
        </label>
        <label className="field">
          <span>Params (B)</span>
          <span style={{ display: 'flex', gap: 4, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
            <input type="number" name="min" min="0" step="any" defaultValue={filters.minParamsB} placeholder="min" style={{ width: 70 }} aria-label="Minimum parameters in billions" />
            <input type="number" name="max" min="0" step="any" defaultValue={filters.maxParamsB} placeholder="max" style={{ width: 70 }} aria-label="Maximum parameters in billions" />
          </span>
        </label>
        <label className="field">
          <span>Sort</span>
          <select name="sort" defaultValue={filters.sort}>
            <option value="released">Newest release</option>
            <option value="params_desc">Largest</option>
            <option value="params_asc">Smallest</option>
            <option value="name">Name</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit">Apply</button>
        {active > 0 && <Link href="/models" className="btn">Clear</Link>}
      </form>

      <p className="small muted" aria-live="polite">{models.length} model{models.length === 1 ? '' : 's'}</p>

      {models.length === 0 ? (
        <Empty>No models match these filters.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Model</th>
                <th>Released</th>
                <th className="r">Params</th>
                <th>Arch</th>
                <th className="r">Context</th>
                <th className="r">Variants</th>
                <th className="r">Smallest file</th>
                <th>Capabilities</th>
                <th>License</th>
                <th className="r">Results</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.slug}>
                  <td>
                    <Link className="primary" href={`/models/${m.slug}`}>{m.name}</Link>
                    <span className="sub">{m.familyName} · {m.developerName}</span>
                  </td>
                  <td className="num">{formatDate(m.releasedOn)}</td>
                  <td className="r num">
                    {formatParams(m.paramsTotal)}
                    {m.paramsActive && <span className="sub">{formatParams(m.paramsActive)} active</span>}
                  </td>
                  <td>{m.architecture === 'moe' ? 'MoE' : 'Dense'}</td>
                  <td className="r num">{formatContext(m.contextLength)}</td>
                  <td className="r num">{m.variantCount}<span className="sub">{m.artifactCount} files</span></td>
                  <td className="r num">{formatBytes(m.smallestArtifactBytes)}</td>
                  <td><div className="tags">{m.capabilities.map((c) => <Tag key={c}>{humanize(c)}</Tag>)}</div></td>
                  <td className="small">
                    {m.licenses.map((l) => (
                      <div key={l.name}>{l.name}{l.commercialUse !== 'allowed' && <span className="faint"> · {l.commercialUse}</span>}</div>
                    ))}
                  </td>
                  <td className="r num">{m.resultCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
