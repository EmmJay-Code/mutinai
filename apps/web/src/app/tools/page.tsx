import { catalog, getDb } from '@mutinai/db';
import { PROJECT_CATEGORIES } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, PageHead, Tag } from '@/components/ui';
import { humanize, searchParam } from '@/lib/format';

export const metadata: Metadata = { title: 'Tools' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ToolsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const category = searchParam(sp, 'category');
  const q = searchParam(sp, 'q');
  const projects = await catalog.listProjects(getDb(), { category, q });

  return (
    <>
      <PageHead
        eyebrow="Directory"
        title="Tools & projects"
        lede="Open-source inference runtimes, interfaces, coding assistants, fine-tuning frameworks, evaluation harnesses and gateways."
      />
      <form className="filters" action="/tools">
        <label className="field"><span>Search</span><input type="search" name="q" defaultValue={q} placeholder="Name or repository" /></label>
        <label className="field">
          <span>Category</span>
          <select name="category" defaultValue={category ?? ''}>
            <option value="">All</option>
            {PROJECT_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" type="submit">Apply</button>
      </form>

      {projects.length === 0 ? <Empty>No tools match.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Project</th><th>Category</th><th>License</th><th>Language</th><th>Runtime support</th><th className="r">Results</th></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.slug}>
                  <td>
                    <Link className="primary" href={`/tools/${p.slug}`}>{p.name}</Link>
                    <span className="sub">{p.summary}</span>
                  </td>
                  <td>{humanize(p.category)}</td>
                  <td className="small">{p.license ? <>{p.license.name}{p.license.osiApproved ? <span className="faint"> · OSI</span> : <span className="faint"> · {p.license.commercialUse}</span>}</> : '—'}</td>
                  <td className="small">{p.primaryLanguage}</td>
                  <td>
                    {p.runtime ? (
                      <div className="tags">
                        {p.runtime.formats.map((f) => <Tag key={f}>{f}</Tag>)}
                        {p.runtime.backends.map((b) => <Tag key={b}>{b}</Tag>)}
                        {p.runtime.supportsOffload && <Tag title="Can place part of a model in system RAM">offload</Tag>}
                        {p.runtime.supportsMultiGpu && <Tag>multi-GPU</Tag>}
                      </div>
                    ) : <span className="faint">—</span>}
                  </td>
                  <td className="r num">{p.resultCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
