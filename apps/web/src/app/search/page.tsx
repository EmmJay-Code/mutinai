import { catalog, compatQueries, getDb } from '@mutinai/db';
import { describeModel, isSpecialist, memoryPhrase, modelIntent, profileMean, searchIntent } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, EntityLink, PageHead } from '@/components/ui';
import { EntityMark, entityTypeFor } from '@/components/viz';
import { searchParam } from '@/lib/format';
import { measurementPolicy } from '@/lib/community-visibility';

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
  const db = getDb();
  const hits = q ? await catalog.searchEntities(db, q, { kinds: kind ? [kind] : undefined, limit: 80 }) : [];
  // A query that states a purpose ("like chatgpt", "for coding") gets models chosen for that purpose, not only names.
  const purpose = q && (!kind || kind === 'model') ? searchIntent(q) : null;
  let suggested: { slug: string; name: string; developerName: string; what: string; memory: string | null }[] = [];
  if (purpose) {
    const [models, profiles, reach] = await Promise.all([
      catalog.listModels(db),
      catalog.listCapabilityProfiles(db),
      compatQueries.compatSummaryByModel(db, { contextLength: 8192, ...measurementPolicy() }),
    ]);
    const intent = modelIntent(purpose.modelIntent);
    const share = (slug: string) => (reach[slug]?.of ? reach[slug]!.runsWell / reach[slug]!.of : 0);
    suggested = models
      .filter((m) => (intent ? intent.test(m) : m.capabilities.includes(purpose.capability ?? '')) && !(purpose.generalOnly && isSpecialist(m)))
      .map((m) => ({ m, rank: intent ? intent.score(m, { profile: profiles[m.slug], reach: reach[m.slug] }) : profileMean(profiles[m.slug]) + share(m.slug) * 50 }))
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 6)
      .map(({ m }) => ({ slug: m.slug, name: m.name, developerName: m.developerName, what: describeModel(m, profiles[m.slug]).summary, memory: memoryPhrase(m.minMemoryGb) ? `${memoryPhrase(m.minMemoryGb)!.amount} (estimate)` : null }));
  }
  const seeAll = purpose ? (purpose.modelIntent ? `/models?for=${purpose.modelIntent}#all-models` : `/models?capability=${purpose.capability}#all-models`) : '/models';
  const grouped = GROUPS.map(([k, label]) => ({ k, label, items: hits.filter((h) => h.kind === k) })).filter((g) => g.items.length);
  const href = (k?: string) => `/search?q=${encodeURIComponent(q)}${k ? `&kind=${k}` : ''}`;

  return (
    <>
      <PageHead eyebrow={q ? `Search · ${hits.length + suggested.length} results` : 'Search'} title={q ? <>“{q}”</> : 'Search models, hardware and tools'}>
        <form className="dir-search" action="/search" role="search">
          {kind && <input type="hidden" name="kind" value={kind} />}
          <label className="sr-only" htmlFor="search-q">Search</label>
          <input id="search-q" type="search" name="q" defaultValue={q} placeholder="e.g. like chatgpt, qwen coder, 24GB GPU" autoFocus />
          <button type="submit">Search</button>
        </form>
      </PageHead>
      <div className="dir-bar">
        {q && (
          <div className="chips">
            <Link className="chip" aria-pressed={!kind} href={href()}>Everything</Link>
            {GROUPS.slice(0, 6).map(([k, label]) => <Link key={k} className="chip" aria-pressed={kind === k} href={href(k)}>{label}</Link>)}
          </div>
        )}
      </div>

      {suggested.length > 0 && purpose && (
        <section className="section-tight" aria-labelledby="g-purpose">
          <div className="section-head">
            <div>
              <h2 id="g-purpose"><EntityMark type="model" /> {purpose.label} <span className="muted">{suggested.length}</span></h2>
              <p>{purpose.explain} Most capable first.</p>
            </div>
            <Link className="more" href={seeAll}>All of them →</Link>
          </div>
          <ul className="list-plain" style={{ columns: 2, columnGap: 32 }}>
            {suggested.map((m) => (
              <li key={m.slug} style={{ breakInside: 'avoid' }}>
                <span style={{ font: '600 15.5px/1.3 var(--serif)' }}><Link href={`/models/${m.slug}`}>{m.name}</Link></span>
                <div className="small muted">{m.what} {m.developerName}{m.memory ? ` · ${m.memory}` : ''}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!q ? (
        <Empty>Search models, hardware, tools, variants, downloads and organizations by name, alias or repository id — or say what you want, like “something like ChatGPT” or “for coding”.</Empty>
      ) : hits.length === 0 && suggested.length > 0 ? null : hits.length === 0 ? (
        <Empty>Nothing matched “{q}”. Try a shorter name, or browse <Link href="/models">models</Link>, <Link href="/hardware">hardware</Link> or <Link href="/tools">tools</Link>.</Empty>
      ) : (
        grouped.map((g) => (
          <section key={g.k} className="section-tight" aria-labelledby={`g-${g.k}`}>
            <div className="section-head"><h2 id={`g-${g.k}`}><EntityMark type={entityTypeFor(g.k)} /> {g.label} <span className="muted">{g.items.length}</span></h2></div>
            <ul className="list-plain" style={{ columns: g.items.length > 3 ? 2 : 1, columnGap: 32 }}>
              {g.items.map((h) => (
                <li key={`${h.kind}:${h.slug}`} style={{ breakInside: 'avoid' }}>
                  <span style={{ font: '600 15.5px/1.3 var(--serif)' }}><EntityLink entity={h} /></span>
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
