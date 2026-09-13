import { catalog, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, EntityLink } from '@/components/ui';
import { searchParam } from '@/lib/format';

export const metadata: Metadata = { title: 'Search' };

type SP = Promise<Record<string, string | string[] | undefined>>;

const GROUPS: [string, string][] = [
  ['model', 'Models'],
  ['hardware_device', 'Hardware'],
  ['hardware_configuration', 'Systems'],
  ['project', 'Tools'],
  ['model_variant', 'Model variants'],
  ['model_artifact', 'Downloads'],
  ['organization', 'Organizations'],
  ['model_release', 'Releases'],
  ['model_family', 'Families'],
  ['benchmark', 'Benchmarks'],
  ['quantization_scheme', 'Quantization formats'],
];

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = searchParam(sp, 'q') ?? '';
  const kind = searchParam(sp, 'kind');
  const hits = q ? await catalog.searchEntities(getDb(), q, { kinds: kind ? [kind] : undefined, limit: 80 }) : [];
  const grouped = GROUPS.map(([k, label]) => ({ k, label, items: hits.filter((h) => h.kind === k) })).filter((g) => g.items.length);
  const href = (k?: string) => `/search?q=${encodeURIComponent(q)}${k ? `&kind=${k}` : ''}`;

  return (
    <>
      <div className="discover-head">
        <div className="eyebrow">Search</div>
        <h1>{q ? <>Results for “{q}”</> : 'Search Mutinai'}</h1>
        <form className="searchbar" action="/search" role="search">
          {kind && <input type="hidden" name="kind" value={kind} />}
          <label className="sr-only" htmlFor="search-q">Search</label>
          <input id="search-q" type="search" name="q" defaultValue={q} placeholder="e.g. qwen coder, 24GB GPU, llama.cpp" autoFocus />
          <button className="btn btn-primary" type="submit">Search</button>
        </form>
        {q && (
          <div className="chips quick-filters">
            <Link className="chip" aria-pressed={!kind} href={href()}>Everything</Link>
            {GROUPS.slice(0, 6).map(([k, label]) => <Link key={k} className="chip" aria-pressed={kind === k} href={href(k)}>{label}</Link>)}
          </div>
        )}
      </div>

      {!q ? (
        <Empty>Search models, hardware, tools, variants, downloads and organizations by name, alias or repository id.</Empty>
      ) : hits.length === 0 ? (
        <Empty>Nothing matched “{q}”. Try a shorter name, or browse <Link href="/models">models</Link>, <Link href="/hardware">hardware</Link> or <Link href="/tools">tools</Link>.</Empty>
      ) : (
        grouped.map((g) => (
          <section key={g.k} className="section-tight" aria-labelledby={`g-${g.k}`}>
            <h2 id={`g-${g.k}`} className="subhead">{g.label} <span className="faint">{g.items.length}</span></h2>
            <ul className="list-plain" style={{ maxWidth: 820 }}>
              {g.items.map((h) => (
                <li key={`${h.kind}:${h.slug}`}>
                  <span style={{ fontSize: 17, fontWeight: 500 }}><EntityLink entity={h} /></span>
                  {h.summary && <div className="small muted">{h.summary}</div>}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
