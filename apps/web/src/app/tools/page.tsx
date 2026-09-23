import { catalog, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EdSection, Group, Masthead, StartStrip, type StartItem } from '@/components/editorial';
import { Empty, LicenseShort } from '@/components/ui';
import { humanize, searchParam } from '@/lib/format';
import { BACKEND_LABEL } from '@/lib/hardware';

export const metadata: Metadata = { title: 'Tools' };

type SP = Promise<Record<string, string | string[] | undefined>>;

const CATEGORY_LABEL: Record<string, string> = {
  runtime: 'Runtimes', ui: 'Chat interfaces', coding_assistant: 'Coding assistants', agent: 'Agents',
  fine_tuning: 'Fine-tuning', evaluation: 'Evaluation', gateway: 'Gateways', library: 'Libraries',
};
/** What each kind of tool is for, in the order a local setup usually needs them. */
const CATEGORY_HINT: Record<string, React.ReactNode> = {
  runtime: <>Loads a model and answers requests. <b>Every setup needs one.</b></>,
  ui: 'A chat window on top of a runtime.',
  coding_assistant: 'Uses a model inside your editor or terminal.',
  agent: 'Lets a model plan and call tools on its own.',
  fine_tuning: 'Adapts a model to your own data.',
  evaluation: 'Measures how good a model really is.',
  gateway: 'One API in front of many models, local or hosted.',
  library: 'Building blocks for your own applications.',
};

export default async function ToolsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const category = searchParam(sp, 'category');
  const q = searchParam(sp, 'q');
  const db = getDb();
  const [projects, all] = await Promise.all([catalog.listProjects(db, { category, q }), catalog.listProjects(db)]);
  const categories = Object.keys(CATEGORY_LABEL).filter((c) => all.some((p) => p.category === c));
  const groups = categories.map((c) => ({ key: c, projects: projects.filter((p) => p.category === c) })).filter((g) => g.projects.length > 0);
  const exploring = !category && !q;
  const has = (c: string) => categories.includes(c);
  const optional = categories.find((c) => c !== 'runtime' && c !== 'ui');

  return (
    <>
      <Masthead
        eyebrow={`Tools · ${all.length} tracked`}
        title="The software between you and the model."
        lede="A local setup is a runtime that loads the model, plus something you type into. Everything else is optional."
      >
        {exploring && (
          <StartStrip
            label="How it fits"
            items={[
              has('runtime') && { href: '#runtime', tag: 'Step 1', name: 'Pick a runtime', why: 'It loads the model and serves answers.' },
              has('ui') && { href: '#ui', tag: 'Step 2', name: 'Add something to type into', why: 'A chat window, or an assistant in your editor.' },
              optional && { href: `#${optional}`, tag: 'Later', name: 'Everything else is optional', why: 'Assistants, fine-tuning, evaluation and gateways, when you need them.' },
            ].filter(Boolean) as StartItem[]}
          />
        )}
      </Masthead>

      <EdSection
        id="all-tools"
        title={<>{category ? CATEGORY_LABEL[category] ?? humanize(category) : 'Every tool, by the job it does'}<span className="count">{projects.length} of {all.length}{q ? ` matching “${q}”` : ''}</span></>}
        intro={category ? <Link className="link" href="/tools">Show all tools</Link> : 'In roughly the order a setup needs them.'}
      >
      <div className="catalog-bar">
        <div className="chips" aria-label="Categories">
          <Link className="chip" aria-pressed={!category} href={q ? `/tools?q=${encodeURIComponent(q)}` : '/tools'}>All</Link>
          {categories.map((c) => (
            <Link key={c} className="chip" aria-pressed={category === c} href={`/tools?category=${c}${q ? `&q=${encodeURIComponent(q)}` : ''}#all-tools`}>
              {CATEGORY_LABEL[c]} <span className="meta">{all.filter((p) => p.category === c).length}</span>
            </Link>
          ))}
        </div>
        <span className="spacer" />
        <form className="bar-search" action="/tools#all-tools" role="search">
          {category && <input type="hidden" name="category" value={category} />}
          <label className="sr-only" htmlFor="tools-q">Search tools</label>
          <input id="tools-q" type="search" name="q" defaultValue={q} placeholder="Search name or repository…" />
        </form>
      </div>

      {projects.length === 0 ? <Empty>No tools match. <Link className="link" href="/tools">Show all tools</Link>.</Empty> : groups.map((g) => (
        <Group key={g.key} id={g.key} top={<span className="n">{g.projects.length} {g.projects.length === 1 ? 'tool' : 'tools'}</span>} title={CATEGORY_LABEL[g.key] ?? humanize(g.key)} hint={CATEGORY_HINT[g.key]}>
          <div className="rows-head rows-tools" aria-hidden="true"><span>Tool</span><span>Works with</span><span className="r">License</span></div>
          <ul className="rows">
            {g.projects.map((p) => (
              <li className="rows-tools" key={p.slug}>
                <div>
                  <div className="name"><Link href={`/tools/${p.slug}`}>{p.name}</Link></div>
                  <span className="desc">{p.summary}</span>
                  <span className="sub">
                    {[p.maintainer?.name, p.primaryLanguage].filter(Boolean).join(' · ')}
                    {p.resultCount ? <span className="measured"> · {p.resultCount} measured result{p.resultCount === 1 ? '' : 's'}</span> : null}
                  </span>
                </div>
                <div>
                  {p.runtime ? (
                    <div className="plats">
                      {p.runtime.formats.map((f) => <span key={f} className="plat mono">{f}</span>)}
                      {[...new Set(p.runtime.backends.map((b) => BACKEND_LABEL[b] ?? b))].map((b) => <span key={b} className="plat">{b}</span>)}
                    </div>
                  ) : <span className="small muted">Any OpenAI-compatible model API</span>}
                </div>
                <span className="r"><LicenseShort commercialUse={p.license ? (p.license.osiApproved ? 'allowed' : p.license.commercialUse) : null} name={p.license?.name} /></span>
              </li>
            ))}
          </ul>
        </Group>
      ))}
      </EdSection>
    </>
  );
}
