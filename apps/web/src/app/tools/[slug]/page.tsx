import { catalog, community, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PerformanceTable, ProvenanceBlock, RatingSummary, ReviewList } from '@/components/results';
import { EntityLink, Facts, PageHead, Section, Tag } from '@/components/ui';
import { formatDate, humanize } from '@/lib/format';
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

  return (
    <>
      <PageHead
        crumbs={[{ href: '/tools', label: 'Tools' }, { href: `/tools?category=${project.category}`, label: humanize(project.category) }]}
        eyebrow={humanize(project.category)}
        title={project.name}
        lede={project.summary}
      >
        {project.repoUrl && <a className="btn btn-small" href={project.repoUrl} rel="noopener noreferrer">Repository</a>}
        {project.homepageUrl && <a className="btn btn-small" href={project.homepageUrl} rel="noopener noreferrer">Website</a>}
        <Link className="btn btn-small" href={`/contribute/review?entity=project:${project.slug}&returnTo=/tools/${project.slug}`}>Review</Link>
      </PageHead>

      <div className="grid grid-main-aside">
        <div>
          <Facts
            items={[
              ['Maintainer', project.maintainer?.name],
              ['License', project.license ? `${project.license.name}${project.license.osiApproved ? ' (OSI)' : ''}` : '—'],
              ['Commercial use', project.license ? humanize(project.license.commercialUse) : '—'],
              ['Language', project.primaryLanguage],
            ]}
          />

          {project.runtime && (
            <Section title="Inference capabilities">
              <Facts
                items={[
                  ['Weight formats', <div key="f" className="tags">{project.runtime.formats.map((f) => <Tag key={f}>{f}</Tag>)}</div>],
                  ['Backends', <div key="b" className="tags">{project.runtime.backends.map((b) => <Tag key={b}>{b}</Tag>)}</div>],
                  ['CPU offload', project.runtime.supportsOffload ? 'Yes — partial layers in system RAM' : 'No'],
                  ['Multi-GPU', project.runtime.supportsMultiGpu ? 'Yes' : 'No'],
                  ['OpenAI-compatible API', project.runtime.openaiCompatibleApi ? 'Yes' : 'No'],
                ]}
              />
            </Section>
          )}

          {project.relations.length > 0 && (
            <Section title="Relationships">
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {project.relations.map((r, i) => (
                      <tr key={i}>
                        <td className="muted" style={{ width: 220 }}>{RELATION_LABEL[r.predicate]?.[r.direction === 'outgoing' ? 0 : 1] ?? humanize(r.predicate)}</td>
                        <td><EntityLink entity={r} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {project.runtime && (
            <Section title="Measured performance with this runtime">
              <PerformanceTable results={project.performanceResults} showModel />
            </Section>
          )}

          <Section title="Reviews">
            <ReviewList reviews={reviews} />
          </Section>
        </div>
        <aside>
          <div className="aside-block panel panel-pad">
            <h3 style={{ marginBottom: 8 }}>Community ratings</h3>
            <RatingSummary aggregates={aggregates} />
          </div>
          {events.length > 0 && (
            <div className="aside-block panel panel-pad">
              <h3 style={{ marginBottom: 6 }}>Releases & events</h3>
              <ul className="list-plain">{events.map((e) => <li key={e.id} className="small"><span className="num muted">{formatDate(e.occurredAt)}</span> {e.url ? <a href={e.url} rel="noopener noreferrer">{e.title}</a> : e.title}</li>)}</ul>
            </div>
          )}
          <div className="aside-block"><ProvenanceBlock provenance={provenance} /></div>
        </aside>
      </div>
    </>
  );
}
