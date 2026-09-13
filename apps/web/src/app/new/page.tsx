import { catalog, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import { EntityLink, PageHead } from '@/components/ui';
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
      <PageHead eyebrow="Timeline" title="What’s new in open AI" lede="Releases, launches and announcements across models, hardware and tools — each linked to the things it affects." />
      {Object.entries(byYear).sort(([a], [b]) => Number(b) - Number(a)).map(([year, list]) => (
        <section key={year} className="section-tight" aria-labelledby={`y-${year}`}>
          <h2 id={`y-${year}`} className="subhead">{year}</h2>
          <ol className="timeline">
            {list.map((e) => (
              <li key={e.id}>
                <time dateTime={isoDate(e.occurredAt)}>{formatDate(e.occurredAt)}</time>
                <div>
                  <div className="meta">{humanize(e.kind)}</div>
                  <div className="title">{e.url ? <a href={e.url} rel="noopener noreferrer">{e.title}</a> : e.title}</div>
                  {e.summary && <div className="muted">{e.summary}</div>}
                  {e.entities.length > 0 && (
                    <div className="tags small" style={{ marginTop: 6 }}>
                      {e.entities.map((x) => <EntityLink key={x.slug} entity={x} />)}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
