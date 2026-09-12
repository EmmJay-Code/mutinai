import { catalog, community, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PerformanceTable, ProvenanceBlock, RatingSummary, ReviewList, SubmissionTable } from '@/components/results';
import { Facts, PageHead, Section, Tag } from '@/components/ui';
import { formatDate, formatGb, humanize } from '@/lib/format';
import { getViewer } from '@/lib/session';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const d = await catalog.getDeviceDetail(getDb(), (await params).slug);
  return { title: d?.name ?? 'Hardware not found' };
}

export default async function DevicePage({ params }: { params: Params }) {
  const { slug } = await params;
  const db = getDb();
  const device = await catalog.getDeviceDetail(db, slug);
  if (!device) notFound();
  const viewer = await getViewer();
  const [reviews, aggregates, submissions, provenance, events] = await Promise.all([
    community.listReviewsForEntities(db, [device.id], viewer),
    community.ratingAggregates(db, [device.id]),
    community.listSubmissions(db, { deviceId: device.id }, viewer),
    catalog.getProvenance(db, device.id),
    catalog.listEvents(db, { entityId: device.id }),
  ]);

  return (
    <>
      <PageHead
        crumbs={[{ href: '/hardware', label: 'Hardware' }, { href: `/hardware?vendor=${device.vendor.slug}`, label: device.vendor.name }]}
        eyebrow={device.deviceKind === 'soc' ? 'SoC / APU' : humanize(device.deviceKind)}
        title={device.name}
        lede={device.summary}
      >
        {device.backends.map((b) => <Tag key={b}>{b}</Tag>)}
        <Link className="btn btn-small" href={`/contribute/review?entity=hardware_device:${device.slug}&returnTo=/hardware/${device.slug}`}>Review</Link>
      </PageHead>

      <div className="grid grid-main-aside">
        <div>
          <Facts
            items={[
              ['Vendor', device.vendor.name],
              ['Memory', device.memoryKind === 'dedicated' ? formatGb(device.memoryGb) : device.memoryKind === 'unified' ? 'Unified (per system)' : 'Uses system RAM'],
              ['Memory type', device.memoryType],
              ['Bandwidth', device.memoryBandwidthGbps ? <span key="bw" className="num">{device.memoryBandwidthGbps} GB/s</span> : '—'],
              ['GPU-usable share', device.memoryKind === 'unified' ? `${Math.round((device.unifiedUsableFraction ?? 0.75) * 100)}% default` : '—'],
              ['TDP', device.tdpWatts ? `${device.tdpWatts} W` : '—'],
              ['Released', formatDate(device.releasedOn)],
              ['Launch price', device.launchPriceUsd ? `$${device.launchPriceUsd.toLocaleString('en-US')}` : '—'],
            ]}
          />

          <Section title="Systems using this device">
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>System</th><th className="r">Accelerator memory</th><th className="r">System RAM</th><th className="r">Measurements</th><th /></tr></thead>
                <tbody>
                  {device.configurations.map((c) => (
                    <tr key={c.slug}>
                      <td><Link className="primary" href={`/hardware/systems/${c.slug}`}>{c.name}</Link></td>
                      <td className="r num">{formatGb(c.acceleratorMemoryGb)}</td>
                      <td className="r num">{c.systemRamGb ? formatGb(c.systemRamGb) : '—'}</td>
                      <td className="r num">{c.resultCount}</td>
                      <td className="r"><Link className="btn btn-small" href={`/run?system=${c.slug}`}>What runs?</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Measured performance">
            <PerformanceTable results={device.performanceResults} showModel />
          </Section>

          <Section title="Community benchmark runs">
            <SubmissionTable submissions={submissions} />
          </Section>

          <Section title="Reviews">
            <ReviewList reviews={reviews} />
          </Section>
        </div>
        <aside>
          <div className="aside-block panel panel-pad">
            <h3 style={{ marginBottom: 8 }}>Community ratings</h3>
            <RatingSummary aggregates={aggregates} />
          </div>
          {device.successors.length > 0 && (
            <div className="aside-block panel panel-pad">
              <h3 style={{ marginBottom: 6 }}>Generations</h3>
              <ul className="list-plain">
                {device.successors.map((s) => (
                  <li key={s.slug}><span className="small muted">{s.direction === 'newer' ? 'Succeeded by' : 'Successor to'}</span> <Link href={`/hardware/${s.slug}`}>{s.name}</Link></li>
                ))}
              </ul>
            </div>
          )}
          {events.length > 0 && (
            <div className="aside-block panel panel-pad">
              <h3 style={{ marginBottom: 6 }}>Timeline</h3>
              <ul className="list-plain">{events.map((e) => <li key={e.id} className="small"><span className="num muted">{formatDate(e.occurredAt)}</span> {e.title}</li>)}</ul>
            </div>
          )}
          <div className="aside-block"><ProvenanceBlock provenance={provenance} /></div>
        </aside>
      </div>
    </>
  );
}
