import { catalog, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, Tag } from '@/components/ui';
import { humanize, searchParam } from '@/lib/format';
import { BACKEND_LABEL } from '@/lib/hardware';

export const metadata: Metadata = { title: 'Tools' };

type SP = Promise<Record<string, string | string[] | undefined>>;

const CATEGORY_LABEL: Record<string, string> = {
  runtime: 'Runtimes',
  ui: 'Chat interfaces',
  coding_assistant: 'Coding assistants',
  agent: 'Agents',
  fine_tuning: 'Fine-tuning',
  evaluation: 'Evaluation',
  gateway: 'Gateways',
  library: 'Libraries',
};

const CATEGORY_PURPOSE: Record<string, string> = {
  runtime: 'Load a model and run it',
  ui: 'Chat with models in a browser',
  coding_assistant: 'Write code with a model',
  agent: 'Build autonomous agents',
  fine_tuning: 'Adapt a model to your data',
  evaluation: 'Measure model quality',
  gateway: 'Route requests across models',
  library: 'Build on models in code',
};

export default async function ToolsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const category = searchParam(sp, 'category');
  const q = searchParam(sp, 'q');
  const db = getDb();
  const [projects, all] = await Promise.all([catalog.listProjects(db, { category, q }), catalog.listProjects(db)]);
  const categories = Object.keys(CATEGORY_LABEL).filter((c) => all.some((p) => p.category === c));

  return (
    <>
      <div className="discover-head">
        <div className="eyebrow">Tools</div>
        <h1>The software around open models.</h1>
        <form className="searchbar" action="/tools" role="search">
          {category && <input type="hidden" name="category" value={category} />}
          <label className="sr-only" htmlFor="tools-q">Search tools</label>
          <input id="tools-q" type="search" name="q" defaultValue={q} placeholder="Search by name or repository…" />
          <button className="btn btn-primary" type="submit">Search</button>
        </form>
        <div className="chips quick-filters" aria-label="Categories">
          <Link className="chip" aria-pressed={!category} href={q ? `/tools?q=${encodeURIComponent(q)}` : '/tools'}>All</Link>
          {categories.map((c) => (
            <Link key={c} className="chip" aria-pressed={category === c} href={`/tools?category=${c}${q ? `&q=${encodeURIComponent(q)}` : ''}`}>{CATEGORY_LABEL[c]}</Link>
          ))}
        </div>
      </div>

      <div className="toolbar">
        <span className="count">{projects.length} tool{projects.length === 1 ? '' : 's'}{category ? ` · ${CATEGORY_PURPOSE[category]}` : ''}</span>
      </div>

      {projects.length === 0 ? <Empty>No tools match.</Empty> : (
        <ul className="result-list">
          {projects.map((p) => (
            <li className="result" key={p.slug}>
              <div>
                <h3><Link href={`/tools/${p.slug}`}>{p.name}</Link></h3>
                <div className="by">{CATEGORY_LABEL[p.category] ?? humanize(p.category)}{p.maintainer ? ` · ${p.maintainer.name}` : ''}</div>
                <p className="desc">{p.summary}</p>
                {p.runtime && (
                  <div className="tags">
                    <span className="small muted">Runs on {[...new Set(p.runtime.backends.map((b) => BACKEND_LABEL[b] ?? b))].join(', ')}</span>
                    {p.runtime.supportsOffload && <Tag title="Can place part of a model in system RAM">CPU offload</Tag>}
                  </div>
                )}
              </div>
              <div className="result-side">
                <div className="small">{p.license ? (p.license.osiApproved ? 'Open source' : 'Source-available') : 'License unknown'}</div>
                {p.license && <div className="small muted">{p.license.name}</div>}
                {p.primaryLanguage && <div className="small muted">{p.primaryLanguage}</div>}
                {p.runtime && <div className="small muted">Loads {p.runtime.formats.join(', ')}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
