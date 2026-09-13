import { catalog, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import { originOfSourceKind, sourceKindLabel } from '@mutinai/domain';
import { Basis, EntityLink, PageHead } from '@/components/ui';
import { EntityMark, type EntityType } from '@/components/viz';

const EVENT_ENTITY: Record<string, EntityType> = { model_release: 'model', runtime_release: 'tool', hardware_launch: 'hardware', benchmark_update: 'bench', announcement: 'event' };
import { formatDate, humanize, isoDate } from '@/lib/format';

export const metadata: Metadata = { title: 'What’s new' };

export default async function WhatsNewPage() {
  const events = await catalog.listEvents(getDb(), { limit: 200 });
  const byYear = events.reduce<Record<string, typeof events>>((acc, e) => {
    const y = String(new Date(e.occurredAt).getUTCFullYear());
    (acc[y] ??= []).push(e);
    return acc;
  }, {});
  return (
    <>
      <PageHead eyebrow="Timeline" title="What’s new in open models" lede="Releases, launches and announcements across models, hardware and tools — each linked to the things it affects." />
      {Object.entries(byYear).sort(([a], [b]) => Number(b) - Number(a)).map(([year, list]) => (
        <section key={year} className="section-tight" aria-labelledby={`y-${year}`}>
          <div className="section-head"><h2 id={`y-${year}`}>{year} <span className="muted">{list.length}</span></h2></div>
          <ol className="timeline-feed" style={{ marginTop: 0 }}>
            {list.map((e) => (
              <li key={e.id} style={{ alignItems: 'start' }}>
                <time dateTime={isoDate(e.occurredAt)} style={{ paddingTop: 2 }}>{formatDate(e.occurredAt).replace(/ \d{4}$/, '')}</time>
                <span className="node" style={{ marginTop: 1 }}><EntityMark type={EVENT_ENTITY[e.kind] ?? 'event'} label={humanize(e.kind)} /></span>
                <div>
                  <div className="title">{e.url ? <a href={e.url} rel="noopener noreferrer">{e.title}</a> : e.title}</div>
                  {e.summary && <div className="about">{e.summary}</div>}
                  {e.entities.length > 0 && <div className="tags small" style={{ marginTop: 3 }}>{e.entities.map((x) => <EntityLink key={x.slug} entity={x} mark />)}</div>}
                </div>
                <span className="kind">
                  {humanize(e.kind)}
                  {e.sourceKind && (originOfSourceKind(e.sourceKind) === 'live'
                    ? <> <Basis kind="live" title={`Reported by ${e.sourceName}`}>{sourceKindLabel(e.sourceKind)}</Basis></>
                    : originOfSourceKind(e.sourceKind) === 'fixture' ? <> <Basis kind="fixture" title="Illustrative fixture data">Fixture</Basis></> : null)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
