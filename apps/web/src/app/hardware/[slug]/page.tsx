import { catalog, community, compatQueries, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PerformanceTable, ProvenanceBlock, RatingSummary, ReviewList, SubmissionList } from '@/components/results';
import { Crumbs, Empty, EntitySection, Facts, FitBadge, Glance, SectionNav, Speed } from '@/components/ui';
import { formatDate, formatGb, formatParams, humanize } from '@/lib/format';
import { BACKEND_LABEL, DEVICE_KIND_LABEL, deviceSentence, systemSentence } from '@/lib/hardware';
import { getViewer } from '@/lib/session';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const d = await catalog.getDeviceDetail(getDb(), (await params).slug);
  return { title: d?.name ?? 'Hardware not found' };
}

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'runs', label: 'What it runs' },
  { id: 'systems', label: 'Systems' },
  { id: 'performance', label: 'Performance' },
  { id: 'community-runs', label: 'Community results' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'specs', label: 'Specifications' },
  { id: 'sources', label: 'Sources' },
];

export default async function DevicePage({ params }: { params: Params }) {
  const { slug } = await params;
  const db = getDb();
  const device = await catalog.getDeviceDetail(db, slug);
  if (!device) notFound();
  const viewer = await getViewer();
  const primarySystem = device.configurations[0];
  const [reviews, aggregates, submissions, provenance, events, picks] = await Promise.all([
    community.listReviewsForEntities(db, [device.id], viewer),
    community.ratingAggregates(db, [device.id]),
    community.listSubmissions(db, { deviceId: device.id }, viewer),
    catalog.getProvenance(db, device.id),
    catalog.listEvents(db, { entityId: device.id }),
    primarySystem
      ? compatQueries.loadReferenceHardware(db, primarySystem.slug).then((hw) => (hw ? compatQueries.runCompatibility(db, hw, { contextLength: 8192 }) : []))
      : Promise.resolve([]),
  ]);
  const top = picks.filter((p) => p.recommended && p.recommended.result.placement !== 'hybrid').sort((a, b) => b.paramsTotal - a.paramsTotal).slice(0, 6);
  const kindLabel = DEVICE_KIND_LABEL[device.deviceKind] ?? humanize(device.deviceKind);

  return (
    <>
      <Crumbs crumbs={[{ href: '/hardware', label: 'Hardware' }, { href: `/hardware?vendor=${device.vendor.slug}`, label: device.vendor.name }]} />
      <header className="entity-hero">
        <div className="eyebrow">{kindLabel}</div>
        <h1>{device.name}</h1>
        <p className="lede">{deviceSentence(device)}</p>
        <Glance
          items={[
            ['Memory', device.memoryKind === 'dedicated' ? formatGb(device.memoryGb) : device.memoryKind === 'unified' ? 'Unified' : 'System RAM', device.memoryType ?? undefined],
            ['Memory speed', device.memoryBandwidthGbps ? `${device.memoryBandwidthGbps.toLocaleString('en-US')} GB/s` : '—', 'higher = faster generation'],
            ['Power', device.tdpWatts ? `${device.tdpWatts} W` : '—'],
            ['Launch price', device.launchPriceUsd ? `$${device.launchPriceUsd.toLocaleString('en-US')}` : '—', device.releasedOn ? formatDate(device.releasedOn) : undefined],
          ]}
        />
        <div className="page-head-actions">
          {primarySystem && <Link className="btn btn-primary" href={`/run?system=${primarySystem.slug}`}>What can it run?</Link>}
          <Link className="btn" href={`/contribute/review?entity=hardware_device:${device.slug}&returnTo=/hardware/${device.slug}`}>Review</Link>
        </div>
      </header>

      <SectionNav items={SECTIONS} />

      <EntitySection id="overview" title="Overview">
        <div className="split-wide">
          <div className="prose">
            <p>{device.summary}</p>
            <p>Works with {[...new Set(device.backends.map((b) => BACKEND_LABEL[b] ?? b))].join(', ')} software backends — which decides which <Link href="/tools?category=runtime">runtimes</Link> can use it.</p>
            {device.successors.length > 0 && (
              <p>
                {device.successors.map((s, i) => (
                  <span key={s.slug}>{i > 0 && ' '}{s.direction === 'newer' ? 'Succeeded by' : 'Successor to'} <Link href={`/hardware/${s.slug}`}>{s.name}</Link>.</span>
                ))}
              </p>
            )}
          </div>
          <aside>
            <h3 className="subhead" style={{ marginTop: 0 }}>What owners say</h3>
            <RatingSummary aggregates={aggregates} />
          </aside>
        </div>
      </EntitySection>

      <EntitySection id="runs" title="What it runs" intro={primarySystem ? `The largest models that run on the ${primarySystem.name}, at 8K context.` : 'No reference system uses this device yet.'}>
        {top.length === 0 ? <Empty>No compatibility data yet.</Empty> : (
          <ul className="pick-list" style={{ maxWidth: 760 }}>
            {top.map((p) => (
              <li key={p.variantSlug}>
                <div>
                  <Link className="name" href={`/models/${p.modelSlug}#${p.variantSlug}`}>{p.variantName}</Link>
                  <div className="small muted">{formatParams(p.paramsTotal)} · {p.recommended!.row.schemeName} via {p.recommended!.runtime.name}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <FitBadge fit={p.recommended!.result.fit} />
                  <div className="small"><Speed speed={p.recommended!.result.speed} /></div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {primarySystem && <p style={{ marginTop: 'var(--s4)' }}><Link href={`/run?system=${primarySystem.slug}`}>See the full compatibility list →</Link></p>}
      </EntitySection>

      <EntitySection id="systems" title="Systems using it">
        <ul className="list-plain">
          {device.configurations.map((c) => (
            <li key={c.slug}>
              <Link href={`/hardware/systems/${c.slug}`} style={{ fontWeight: 600 }}>{c.name}</Link>
              <div className="small muted">{systemSentence(c)} <Link href={`/run?system=${c.slug}`}>What runs →</Link></div>
            </li>
          ))}
        </ul>
      </EntitySection>

      <EntitySection id="performance" title="Measured performance" intro="Throughput on systems containing this device.">
        <PerformanceTable results={device.performanceResults} showModel />
      </EntitySection>

      <EntitySection id="community-runs" title="Community results">
        <SubmissionList submissions={submissions} />
      </EntitySection>

      <EntitySection id="reviews" title="Reviews">
        <ReviewList reviews={reviews} />
      </EntitySection>

      <EntitySection id="specs" title="Specifications">
        <Facts
          items={[
            ['Vendor', device.vendor.name],
            ['Type', kindLabel],
            ['Memory', device.memoryKind === 'dedicated' ? formatGb(device.memoryGb) : device.memoryKind === 'unified' ? 'Unified (per system)' : 'Uses system RAM'],
            ['Memory type', device.memoryType],
            ['Bandwidth', device.memoryBandwidthGbps ? `${device.memoryBandwidthGbps} GB/s` : '—'],
            ['GPU-usable share', device.memoryKind === 'unified' ? `${Math.round((device.unifiedUsableFraction ?? 0.75) * 100)}% by default` : '—'],
            ['Backends', device.backends.join(', ')],
            ['TDP', device.tdpWatts ? `${device.tdpWatts} W` : '—'],
            ['Released', formatDate(device.releasedOn)],
            ['Launch price', device.launchPriceUsd ? `$${device.launchPriceUsd.toLocaleString('en-US')}` : '—'],
          ]}
        />
      </EntitySection>

      <EntitySection id="sources" title="Sources & history">
        <div className="split">
          <ProvenanceBlock provenance={provenance} />
          <div>
            <h3 className="subhead" style={{ marginTop: 'var(--s4)' }}>Timeline</h3>
            {events.length === 0 ? <p className="small muted">No events recorded.</p> : (
              <ul className="list-plain">{events.map((e) => <li key={e.id} className="small"><span className="num muted">{formatDate(e.occurredAt)}</span> {e.title}</li>)}</ul>
            )}
          </div>
        </div>
      </EntitySection>
    </>
  );
}
