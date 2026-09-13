import { catalog, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, LicenseShort, Tag } from '@/components/ui';
import { humanize, searchParam } from '@/lib/format';
import { BACKEND_LABEL } from '@/lib/hardware';

export const metadata: Metadata = { title: 'Tools' };

type SP = Promise<Record<string, string | string[] | undefined>>;

const CATEGORY_LABEL: Record<string, string> = {
  runtime: 'Runtimes', ui: 'Chat interfaces', coding_assistant: 'Coding assistants', agent: 'Agents',
  fine_tuning: 'Fine-tuning', evaluation: 'Evaluation', gateway: 'Gateways', library: 'Libraries',
};
const CATEGORY_SINGULAR: Record<string, string> = {
  runtime: 'Runtime', ui: 'Chat interface', coding_assistant: 'Coding assistant', agent: 'Agent',
  fine_tuning: 'Fine-tuning', evaluation: 'Evaluation', gateway: 'Gateway', library: 'Library',
};

export default async function ToolsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const category = searchParam(sp, 'category');
  const q = searchParam(sp, 'q');
  const db = getDb();
  const [projects, all] = await Promise.all([catalog.listProjects(db, { category, q }), catalog.listProjects(db)]);
  const categories = Object.keys(CATEGORY_LABEL).filter((c) => all.some((p) => p.category === c));
  const maxResults = Math.max(1, ...all.map((p) => p.resultCount));

  return (
    <>
      <div className="dir-head">
        <h1><span className="glyph g-tool" aria-hidden="true" /> Tools</h1>
        <span className="count">{projects.length} of {all.length}</span>
        <form className="dir-search" action="/tools" role="search">
          {category && <input type="hidden" name="category" value={category} />}
          <label className="sr-only" htmlFor="tools-q">Search tools</label>
          <input id="tools-q" type="search" name="q" defaultValue={q} placeholder="Search name or repository…" />
          <button type="submit">Search</button>
        </form>
      </div>
      <div className="dir-bar">
        <div className="chips" aria-label="Categories">
          <Link className="chip" aria-pressed={!category} href={q ? `/tools?q=${encodeURIComponent(q)}` : '/tools'}>All</Link>
          {categories.map((c) => (
            <Link key={c} className="chip" aria-pressed={category === c} href={`/tools?category=${c}${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
              {CATEGORY_LABEL[c]} <span className="meta">{all.filter((p) => p.category === c).length}</span>
            </Link>
          ))}
        </div>
      </div>

      {projects.length === 0 ? <Empty>No tools match.</Empty> : (
        <>
          <div className="index-head tools-grid" aria-hidden="true"><span /><span>Tool</span><span>Works with</span><span>License</span><span>Measurements</span></div>
          <ul className="list-plain">
            {projects.map((p) => (
              <li className="index-row tools-grid" key={p.slug} style={{ borderTop: 0 }}>
                <span className="glyph g-tool" aria-hidden="true" />
                <div>
                  <div className="name"><Link href={`/tools/${p.slug}`}>{p.name}</Link></div>
                  <div className="sub">{CATEGORY_SINGULAR[p.category] ?? humanize(p.category)}{p.maintainer ? ` · ${p.maintainer.name}` : ''}{p.primaryLanguage ? ` · ${p.primaryLanguage}` : ''}</div>
                  <div className="desc">{p.summary}</div>
                </div>
                <div>
                  <span className="cell-label">Works with</span>
                  {p.runtime ? (
                    <div className="tags">
                      {p.runtime.formats.map((f) => <Tag key={f}><span className="mono">{f}</span></Tag>)}
                      <span className="small muted">{[...new Set(p.runtime.backends.map((b) => BACKEND_LABEL[b] ?? b))].join(', ')}</span>
                    </div>
                  ) : <span className="small muted">Any OpenAI-compatible model API</span>}
                </div>
                <div><span className="cell-label">License</span><LicenseShort commercialUse={p.license ? (p.license.osiApproved ? 'allowed' : p.license.commercialUse) : null} name={p.license?.name} /></div>
                <div>
                  <span className="cell-label">Measurements</span>
                  {p.resultCount ? (
                    <div className="linebar"><div className="top"><span className="muted">results</span><span className="value">{p.resultCount}</span></div><div className="track"><div className="fill" style={{ width: `${(p.resultCount / maxResults) * 100}%`, background: 'var(--e-tool)' }} /></div></div>
                  ) : <span className="small faint">—</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
