import { catalog, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import { Empty, EntityLink, KindTag, PageHead } from '@/components/ui';
import { KIND_LABEL, searchParam } from '@/lib/format';

export const metadata: Metadata = { title: 'Search' };

type SP = Promise<Record<string, string | string[] | undefined>>;

const KIND_FILTERS = ['model', 'model_variant', 'model_artifact', 'hardware_device', 'hardware_configuration', 'project', 'organization', 'benchmark'];

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = searchParam(sp, 'q') ?? '';
  const kind = searchParam(sp, 'kind');
  const hits = q ? await catalog.searchEntities(getDb(), q, { kinds: kind ? [kind] : undefined, limit: 60 }) : [];

  return (
    <>
      <PageHead eyebrow="Search" title={q ? <>Results for “{q}”</> : 'Search the ecosystem'} />
      <form className="filters" action="/search" role="search">
        <label className="field" style={{ flex: '1 1 320px' }}>
          <span>Query</span>
          <input type="search" name="q" defaultValue={q} placeholder="e.g. qwen coder, 24GB GPU, llama.cpp" autoFocus />
        </label>
        <label className="field">
          <span>Kind</span>
          <select name="kind" defaultValue={kind ?? ''}>
            <option value="">Everything</option>
            {KIND_FILTERS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" type="submit">Search</button>
      </form>

      {!q ? (
        <Empty>Search models, variants, quantizations, hardware, systems, tools and organizations. Matches names, aliases, repository ids and related entities.</Empty>
      ) : hits.length === 0 ? (
        <Empty>Nothing matched “{q}”.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th style={{ width: 120 }}>Kind</th><th>Name</th><th>Summary</th></tr></thead>
            <tbody>
              {hits.map((h) => (
                <tr key={`${h.kind}:${h.slug}`}>
                  <td><KindTag kind={h.kind} /></td>
                  <td className="primary"><EntityLink entity={h} /></td>
                  <td className="small muted">{h.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
