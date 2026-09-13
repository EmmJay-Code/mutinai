import { catalog, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { collapseDuplicates, FRESHNESS, originOfSourceKind, sourceKindLabel } from '@mutinai/domain';
import { Basis, EntityLink, PageHead } from '@/components/ui';
import { EntityMark } from '@/components/viz';
import { entityTypeOfEvent, eventGroup, EVENT_GROUPS } from '@/lib/events';
import { formatDate, humanize, isoDate, searchParam } from '@/lib/format';

export const metadata: Metadata = { title: 'What’s new' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function WhatsNewPage({ searchParams }: { searchParams: SP }) {
  const group = eventGroup(searchParam(await searchParams, 'kind'));
  // Ordered by when things happened. Future-dated entries are bad data; re-published copies of a release are one event.
  const latestAllowed = Date.now() + FRESHNESS.futureToleranceHours * 3_600_000;
  const all = collapseDuplicates((await catalog.listEvents(getDb(), { limit: 300 })).filter((e) => new Date(e.occurredAt).getTime() <= latestAllowed)).slice(0, 200);
  const events = group ? all.filter((e) => group.kinds.includes(e.kind)) : all;
  const byYear = events.reduce<Record<string, typeof events>>((acc, e) => {
    const y = String(new Date(e.occurredAt).getUTCFullYear());
    (acc[y] ??= []).push(e);
    return acc;
  }, {});
  return (
    <>
      <PageHead eyebrow="Timeline" title="What’s new in open models" lede="Releases, launches and announcements across models, hardware and tools — each linked to the things it affects." />
      <div className="dir-bar">
        <div className="chips" aria-label="Filter the timeline">
          <Link className="chip" aria-pressed={!group} href="/new">Everything <span className="faint">{all.length}</span></Link>
          {EVENT_GROUPS.map((g) => (
            <Link key={g.key} className="chip" aria-pressed={group?.key === g.key} href={`/new?kind=${g.key}`} title={g.hint}>
              {g.label} <span className="faint">{all.filter((e) => g.kinds.includes(e.kind)).length}</span>
            </Link>
          ))}
        </div>
      </div>
      {group && <p className="intent-explain"><span>{group.hint}.</span><Link className="link" href="/new">Show everything</Link></p>}
      {events.length === 0 && (
        <p className="empty">
          Nothing of this kind is tracked yet. It will appear here as soon as a source reports it — Mutinai never fills an empty timeline with anything else.
        </p>
      )}
      {Object.entries(byYear).sort(([a], [b]) => Number(b) - Number(a)).map(([year, list]) => (
        <section key={year} className="section-tight" aria-labelledby={`y-${year}`}>
          <div className="section-head"><h2 id={`y-${year}`}>{year} <span className="muted">{list.length}</span></h2></div>
          <ol className="timeline-feed" style={{ marginTop: 0 }}>
            {list.map((e) => (
              <li key={e.id} style={{ alignItems: 'start' }}>
                <time dateTime={isoDate(e.occurredAt)} style={{ paddingTop: 2 }}>{formatDate(e.occurredAt).replace(/ \d{4}$/, '')}</time>
                <span className="node" style={{ marginTop: 1 }}><EntityMark type={entityTypeOfEvent(e.kind)} label={humanize(e.kind)} /></span>
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
