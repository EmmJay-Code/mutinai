import { catalog, community, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PerformanceTable, ProvenanceBlock, RatingSummary, ReviewList } from '@/components/results';
import { Crumbs, Empty, EntityLink, EntitySection, Facts, Glance, SectionNav, Tag } from '@/components/ui';
import { formatDate, humanize } from '@/lib/format';
import { BACKEND_LABEL } from '@/lib/hardware';
import { getViewer } from '@/lib/session';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await catalog.getProjectDetail(getDb(), (await params).slug);
  return { title: p?.name ?? 'Tool not found' };
}

const RELATION_LABEL: Record<string, [string, string]> = {
  built_on: ['Built on', 'Used as a foundation by'],
  integrates_with: ['Integrates with', 'Integrated by'],
  implements_benchmark: ['Implements benchmark', 'Implemented by'],
  successor_of: ['Successor to', 'Succeeded by'],
};

const CATEGORY_SINGULAR: Record<string, string> = {
  runtime: 'Inference runtime',
  ui: 'Chat interface',
  coding_assistant: 'Coding assistant',
  agent: 'Agent framework',
  fine_tuning: 'Fine-tuning framework',
  evaluation: 'Evaluation tool',
  gateway: 'Model gateway',
  library: 'Library',
};

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
    { id: 'overview', label: 'Overview' },
    ...(project.runtime ? [{ id: 'capabilities', label: 'Capabilities' }] : []),
    { id: 'relationships', label: 'Relationships' },
    ...(project.runtime ? [{ id: 'performance', label: 'Performance' }] : []),
    { id: 'reviews', label: 'Reviews' },
    { id: 'sources', label: 'Sources' },
  ];
  const category = CATEGORY_SINGULAR[project.category] ?? humanize(project.category);

  return (
    <>
      <Crumbs crumbs={[{ href: '/tools', label: 'Tools' }, { href: `/tools?category=${project.category}`, label: category }]} />
      <header className="entity-hero">
        <div className="eyebrow">{category}</div>
        <h1>{project.name}</h1>
        <p className="lede">{project.summary}</p>
        <Glance
          items={[
            ['License', project.license ? (project.license.osiApproved ? 'Open source' : 'Source-available') : '—', project.license?.name],
            ['Language', project.primaryLanguage],
            ['Maintained by', project.maintainer?.name ?? '—'],
            ...(project.runtime ? ([['Runs on', [...new Set(project.runtime.backends.map((b) => BACKEND_LABEL[b] ?? b))].slice(0, 2).join(', '), project.runtime.backends.length > 2 ? `and ${project.runtime.backends.length - 2} more` : undefined]] as [string, string, string | undefined][]) : []),
          ]}
        />
        <div className="page-head-actions">
          {project.repoUrl && <a className="btn btn-primary" href={project.repoUrl} rel="noopener noreferrer">Repository</a>}
          {project.homepageUrl && <a className="btn" href={project.homepageUrl} rel="noopener noreferrer">Website</a>}
          <Link className="btn" href={`/contribute/review?entity=project:${project.slug}&returnTo=/tools/${project.slug}`}>Review</Link>
        </div>
      </header>

      <SectionNav items={sections} />

      <EntitySection id="overview" title="Overview">
        <div className="split-wide">
          <div>
            {events.length > 0 ? (
              <>
                <h3 className="subhead" style={{ marginTop: 0 }}>Recent releases & news</h3>
                <ul className="list-plain">
                  {events.map((e) => <li key={e.id}><span className="meta">{formatDate(e.occurredAt)}</span><div>{e.url ? <a href={e.url} rel="noopener noreferrer">{e.title}</a> : e.title}</div></li>)}
                </ul>
              </>
            ) : <p className="muted">No recent releases recorded.</p>}
          </div>
          <aside>
            <h3 className="subhead" style={{ marginTop: 0 }}>What users say</h3>
            <RatingSummary aggregates={aggregates} />
          </aside>
        </div>
      </EntitySection>

      {project.runtime && (
        <EntitySection id="capabilities" title="Capabilities" intro="Which model files it loads and which hardware it can use.">
          <Facts
            items={[
              ['Model formats', <div key="f" className="tags">{project.runtime.formats.map((f) => <Tag key={f}>{f}</Tag>)}</div>],
              ['Hardware backends', <div key="b" className="tags">{project.runtime.backends.map((b) => <Tag key={b} title={BACKEND_LABEL[b]}>{b}</Tag>)}</div>],
              ['CPU offload', project.runtime.supportsOffload ? 'Yes — can spill layers into system RAM' : 'No'],
              ['Multiple GPUs', project.runtime.supportsMultiGpu ? 'Yes' : 'No'],
              ['OpenAI-compatible API', project.runtime.openaiCompatibleApi ? 'Yes' : 'No'],
            ]}
          />
        </EntitySection>
      )}

      <EntitySection id="relationships" title="Relationships">
        {project.relations.length === 0 ? <Empty>No relationships recorded.</Empty> : (
          <ul className="list-plain" style={{ maxWidth: 760 }}>
            {project.relations.map((r, i) => (
              <li key={i}>
                <span className="muted">{RELATION_LABEL[r.predicate]?.[r.direction === 'outgoing' ? 0 : 1] ?? humanize(r.predicate)}</span>{' '}
                <EntityLink entity={r} />
              </li>
            ))}
          </ul>
        )}
      </EntitySection>

      {project.runtime && (
        <EntitySection id="performance" title="Measured performance with this runtime">
          <PerformanceTable results={project.performanceResults} showModel />
        </EntitySection>
      )}

      <EntitySection id="reviews" title="Reviews">
        <ReviewList reviews={reviews} />
      </EntitySection>

      <EntitySection id="sources" title="Sources & history">
        <ProvenanceBlock provenance={provenance} />
      </EntitySection>
    </>
  );
}
