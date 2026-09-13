import { catalog, community, getDb } from '@mutinai/db';
import { COMPUTE_BACKENDS, WEIGHT_FORMATS } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { IfContributing } from '@/components/preview';
import { notFound } from 'next/navigation';
import { PerformanceTable, ProvenanceBlock, RatingSummary, ReviewList } from '@/components/results';
import { Crumbs, Empty, EntityLink, EntitySection, Glance, LicenseShort, SectionNav } from '@/components/ui';
import { EntityMark, entityTypeFor } from '@/components/viz';
import { formatDate, humanize } from '@/lib/format';
import { BACKEND_LABEL } from '@/lib/hardware';
import { getViewer } from '@/lib/session';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await catalog.getProjectDetail(getDb(), (await params).slug);
  return { title: p?.name ?? 'Tool not found' };
}

const RELATION_LABEL: Record<string, [string, string]> = {
  built_on: ['Built on', 'Foundation for'],
  integrates_with: ['Integrates with', 'Integrated by'],
  implements_benchmark: ['Implements', 'Implemented by'],
  successor_of: ['Successor to', 'Succeeded by'],
};

const CATEGORY_SINGULAR: Record<string, string> = {
  runtime: 'Inference runtime', ui: 'Chat interface', coding_assistant: 'Coding assistant', agent: 'Agent framework',
  fine_tuning: 'Fine-tuning framework', evaluation: 'Evaluation tool', gateway: 'Model gateway', library: 'Library',
};

function Check({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="nowrap" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: on ? 'var(--ink)' : 'var(--faint)' }}>
      <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: on ? 'var(--e-tool)' : 'transparent', boxShadow: on ? 'none' : 'inset 0 0 0 1.5px var(--line-strong)' }} />
      {label}<span className="sr-only">{on ? ': yes' : ': no'}</span>
    </span>
  );
}

export default async function ToolPage({ params }: { params: Params }) {
  const { slug } = await params;
  const db = getDb();
  const project = await catalog.getProjectDetail(db, slug);
  if (!project) notFound();
  const viewer = await getViewer();
  const [reviews, aggregates, provenance, events] = await Promise.all([
    community.listReviewsForEntities(db, [project.id], viewer),
    community.ratingAggregates(db, [project.id]),
    catalog.getProvenance(db, project.id),
    catalog.listEvents(db, { entityId: project.id }),
  ]);
  const sections = [
    { id: 'relationships', label: 'Relationships' },
    ...(project.runtime ? [{ id: 'performance', label: 'Performance' }] : []),
    { id: 'reviews', label: 'Reviews' },
    { id: 'sources', label: 'Sources' },
  ];
  const category = CATEGORY_SINGULAR[project.category] ?? humanize(project.category);
  const rt = project.runtime;

  return (
    <>
      <Crumbs crumbs={[{ href: '/tools', label: 'Tools' }, { href: `/tools?category=${project.category}`, label: category }]} />
      <div className="entity-top">
        <header className="entity-hero">
          <div className="kicker"><EntityMark type="tool" word /> · {category}{project.maintainer ? ` · ${project.maintainer.name}` : ''}</div>
          <h1>{project.name}</h1>
          <p className="lede">{project.summary}</p>
          <Glance
            items={[
              ['License', <LicenseShort key="l" commercialUse={project.license ? (project.license.osiApproved ? 'allowed' : project.license.commercialUse) : null} />, project.license?.name],
              ['Language', project.primaryLanguage],
              ['Latest release', events[0] ? formatDate(events[0].occurredAt) : '—', events[0]?.title],
              ['Measurements', String(project.resultCount), rt ? 'with this runtime' : undefined],
            ]}
          />
          <div className="page-head-actions tight">
            {project.repoUrl && <a className="btn btn-primary" href={project.repoUrl} rel="noopener noreferrer">Repository</a>}
            {project.homepageUrl && <a className="btn" href={project.homepageUrl} rel="noopener noreferrer">Website</a>}
            <IfContributing><Link className="btn" href={`/contribute/review?entity=project:${project.slug}&returnTo=/tools/${project.slug}`}>Review</Link></IfContributing>
          </div>
        </header>
        <aside className="verdict" aria-label="At a glance">
          {rt ? (
            <div>
              <h2>What it runs</h2>
              <div className="subhead" style={{ margin: '10px 0 4px' }}>Model formats</div>
              <div className="tags">{WEIGHT_FORMATS.map((f) => <Check key={f} on={rt.formats.includes(f)} label={f} />)}</div>
              <div className="subhead" style={{ margin: '10px 0 4px' }}>Hardware</div>
              <div className="tags">{COMPUTE_BACKENDS.map((b) => <Check key={b} on={rt.backends.includes(b)} label={BACKEND_LABEL[b] ?? b} />)}</div>
              <div className="subhead" style={{ margin: '10px 0 4px' }}>Features</div>
              <div className="tags"><Check on={rt.supportsOffload} label="CPU offload" /><Check on={rt.supportsMultiGpu} label="Multi-GPU" /><Check on={rt.openaiCompatibleApi} label="OpenAI API" /></div>
            </div>
          ) : (
            <div>
              <h2>Connects to</h2>
              {project.relations.length === 0 ? <p className="small muted" style={{ margin: '6px 0 0' }}>No relationships recorded.</p> : (
                <ul className="mini-list" style={{ marginTop: 8 }}>
                  {project.relations.slice(0, 5).map((r, i) => (
                    <li key={i}><EntityMark type={entityTypeFor(r.kind)} /><EntityLink entity={r} /><span className="small muted">{RELATION_LABEL[r.predicate]?.[r.direction === 'outgoing' ? 0 : 1] ?? humanize(r.predicate)}</span></li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div>
            <h2>Users say</h2>
            <div style={{ marginTop: 4 }}><RatingSummary aggregates={aggregates} /></div>
          </div>
        </aside>
      </div>

      <SectionNav items={sections} />

      <div className="split">
        <EntitySection id="relationships" title="Relationships">
          {project.relations.length === 0 ? <Empty>No relationships recorded.</Empty> : (
            <ul className="mini-list">
              {project.relations.map((r, i) => (
                <li key={i}><EntityMark type={entityTypeFor(r.kind)} /><EntityLink entity={r} /><span className="small muted">{RELATION_LABEL[r.predicate]?.[r.direction === 'outgoing' ? 0 : 1] ?? humanize(r.predicate)}</span></li>
              ))}
            </ul>
          )}
        </EntitySection>
        <EntitySection id="releases" title="Releases & news">
          {events.length === 0 ? <Empty>No releases recorded.</Empty> : (
            <ol className="timeline">
              {events.map((e) => <li key={e.id}><time>{formatDate(e.occurredAt)}</time><div>{e.url ? <a className="link" href={e.url} rel="noopener noreferrer">{e.title}</a> : e.title}{e.summary && <div className="small muted">{e.summary}</div>}</div></li>)}
            </ol>
          )}
        </EntitySection>
      </div>

      {rt && (
        <EntitySection id="performance" title="Measured performance with this runtime">
          <PerformanceTable results={project.performanceResults} showModel />
        </EntitySection>
      )}

      <div className="split">
        <EntitySection id="reviews" title="Reviews"><ReviewList reviews={reviews} /></EntitySection>
        <EntitySection id="sources" title="Sources & history"><ProvenanceBlock provenance={provenance} /></EntitySection>
      </div>
    </>
  );
}
