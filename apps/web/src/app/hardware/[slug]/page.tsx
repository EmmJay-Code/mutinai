import { catalog, community, compatQueries, getDb } from '@mutinai/db';
import { compat } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { IfContributing } from '@/components/preview';
import { notFound } from 'next/navigation';
import { PerformanceTable, ProvenanceBlock, RatingSummary, ReviewList, SubmissionList } from '@/components/results';
import { Crumbs, Empty, EntitySection, Facts, FitBadge, Glance, SectionNav, Speed } from '@/components/ui';
import { EntityMark, LinearBar, MemoryScale, ParamsReach } from '@/components/viz';
import { formatDate, formatGb, formatParams, humanize } from '@/lib/format';
import { hideSampleCommunityContent, measurementPolicy, SAMPLE_EMPTY_TEXT } from '@/lib/community-visibility';
import { BACKEND_LABEL, DEVICE_KIND_LABEL, deviceSentence, maxParamsAtQ4, pricePerGb, systemSentence, systemUsableGb } from '@/lib/hardware';
import { getViewer } from '@/lib/session';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const d = await catalog.getDeviceDetail(getDb(), (await params).slug);
  return { title: d?.name ?? 'Hardware not found' };
}

const SECTIONS = [
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
  const [reviews, aggregates, submissions, provenance, events, picks, everyDevice] = await Promise.all([
    community.listReviewsForEntities(db, [device.id], viewer),
    community.ratingAggregates(db, [device.id]),
    community.listSubmissions(db, { deviceId: device.id }, viewer),
    catalog.getProvenance(db, device.id),
    catalog.listEvents(db, { entityId: device.id }),
    primarySystem ? compatQueries.loadReferenceHardware(db, primarySystem.slug).then((hw) => (hw ? compatQueries.runCompatibility(db, hw, { contextLength: 8192, ...measurementPolicy() }) : [])) : Promise.resolve([]),
    catalog.listDevices(db),
  ]);
  // See lib/community-visibility: seeded members never speak for a real product.
  const hideCommunity = hideSampleCommunityContent();
  const shownReviews = hideCommunity ? [] : reviews;
  const shownSubmissions = hideCommunity ? [] : submissions;
  const shownAggregates = hideCommunity ? [] : aggregates;
  const top = picks.filter((p) => p.recommended && p.recommended.result.placement !== 'hybrid').sort((a, b) => b.paramsTotal - a.paramsTotal);
  const kindLabel = DEVICE_KIND_LABEL[device.deviceKind] ?? humanize(device.deviceKind);
  const usable = device.memoryKind === 'dedicated' && device.memoryGb ? device.memoryGb * compat.COMPAT_CONSTANTS.dedicatedUsableFraction : primarySystem ? systemUsableGb(primarySystem).gb : null;
  const maxBandwidth = Math.max(...everyDevice.map((d) => d.memoryBandwidthGbps ?? 0));
  const ppg = pricePerGb(device.launchPriceUsd, device.memoryGb);
  const rankBw = [...everyDevice].sort((a, b) => (b.memoryBandwidthGbps ?? 0) - (a.memoryBandwidthGbps ?? 0)).findIndex((d) => d.slug === device.slug) + 1;

  return (
    <>
      <Crumbs crumbs={[{ href: '/hardware', label: 'Hardware' }, { href: `/hardware?vendor=${device.vendor.slug}`, label: device.vendor.name }]} />
      <div className="entity-top">
        <header className="entity-hero">
          <div className="kicker"><EntityMark type="hardware" word /> · {kindLabel} · {device.vendor.name}</div>
          <h1>{device.name}</h1>
          <p className="lede">{deviceSentence(device)}</p>
          <Glance
            items={[
              ['Memory', device.memoryKind === 'dedicated' ? formatGb(device.memoryGb) : device.memoryKind === 'unified' ? 'Unified' : 'System RAM', device.memoryType ?? undefined],
              ['Memory speed', device.memoryBandwidthGbps ? `${device.memoryBandwidthGbps.toLocaleString('en-US')} GB/s` : '—', rankBw ? `#${rankBw} of ${everyDevice.length} tracked` : undefined],
              ['Power', device.tdpWatts ? `${device.tdpWatts} W` : '—'],
              ['Launch price', device.launchPriceUsd ? `$${device.launchPriceUsd.toLocaleString('en-US')}` : '—', ppg ? `$${ppg} per GB` : device.releasedOn ? formatDate(device.releasedOn) : undefined],
            ]}
          />
          <div className="page-head-actions tight">
            {primarySystem && <Link className="btn btn-primary" href={`/run?system=${primarySystem.slug}`}>What can it run?</Link>}
            <IfContributing><Link className="btn" href={`/contribute/review?entity=hardware_device:${device.slug}&returnTo=/hardware/${device.slug}`}>Review</Link></IfContributing>
          </div>
        </header>
        <aside className="verdict" aria-label="At a glance">
          <div>
            <h2>Capacity <span>{primarySystem ? primarySystem.name.replace(/\s*\(.*\)$/, '') : ''}</span></h2>
            <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
              {usable && <ParamsReach maxB={maxParamsAtQ4(usable)} label="Holds at 4-bit" />}
              {usable && <MemoryScale gb={usable} label="Usable memory" />}
              <LinearBar value={device.memoryBandwidthGbps} max={maxBandwidth} label="Memory speed (GB/s)" display={device.memoryBandwidthGbps ? device.memoryBandwidthGbps.toLocaleString('en-US') : '—'} />
            </div>
          </div>
          <div>
            <h2>Largest that run well <span><Link href={primarySystem ? `/run?system=${primarySystem.slug}` : '/run'}>all →</Link></span></h2>
            {top.length === 0 ? <p className="small muted" style={{ margin: '6px 0 0' }}>No compatibility data yet.</p> : (
              <ul className="pick-list" style={{ marginTop: 4 }}>
                {top.slice(0, 4).map((p) => (
                  <li key={p.variantSlug}>
                    <EntityMark type="variant" />
                    <Link href={`/models/${p.modelSlug}#${p.variantSlug}`} className="small" style={{ fontWeight: 600 }}>{p.variantName}</Link>
                    <span className="small"><Speed speed={p.recommended!.result.speed} /></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2>Owners say <span>{aggregates[0]?.count ?? 0} ratings</span></h2>
            <div style={{ marginTop: 4 }}><RatingSummary aggregates={shownAggregates} emptyText={hideCommunity ? SAMPLE_EMPTY_TEXT : undefined} /></div>
          </div>
        </aside>
      </div>

      <SectionNav items={SECTIONS} />

      <EntitySection id="runs" title="What it runs" intro={primarySystem ? `Largest models without offloading on the ${primarySystem.name}, 8K context.` : 'No reference system uses this device yet.'}>
        {top.length === 0 ? <Empty>No compatibility data yet.</Empty> : (
          <ul className="pick-list" style={{ columns: 2, columnGap: 28 }}>
            {top.slice(0, 10).map((p) => (
              <li key={p.variantSlug} style={{ breakInside: 'avoid' }}>
                <EntityMark type="variant" />
                <div>
                  <Link className="name" href={`/models/${p.modelSlug}#${p.variantSlug}`}>{p.variantName}</Link>
                  <div className="small muted"><span className="num">{formatParams(p.paramsTotal)}</span> · <span className="mono">{p.recommended!.row.schemeName}</span> via {p.recommended!.runtime.name}</div>
                </div>
                <div style={{ textAlign: 'right' }}><FitBadge fit={p.recommended!.result.fit} /><div className="small"><Speed speed={p.recommended!.result.speed} /></div></div>
              </li>
            ))}
          </ul>
        )}
      </EntitySection>

      <EntitySection id="systems" title="Systems using it">
        <ul className="list-plain">
          {device.configurations.map((c) => (
            <li key={c.slug}>
              <Link href={`/hardware/systems/${c.slug}`} style={{ fontWeight: 600 }}><EntityMark type="system" /> {c.name}</Link>
              <div className="small muted">{systemSentence(c)} <Link className="link" href={`/run?system=${c.slug}`}>What runs</Link></div>
            </li>
          ))}
        </ul>
      </EntitySection>

      <EntitySection id="performance" title="Measured performance" intro="Throughput on systems containing this device.">
        <PerformanceTable results={device.performanceResults} showModel />
      </EntitySection>

      <div className="split">
        <EntitySection id="community-runs" title="Community results"><SubmissionList submissions={shownSubmissions} emptyText={hideCommunity ? SAMPLE_EMPTY_TEXT : undefined} /></EntitySection>
        <EntitySection id="reviews" title="Reviews"><ReviewList reviews={shownReviews} emptyText={hideCommunity ? SAMPLE_EMPTY_TEXT : undefined} /></EntitySection>
      </div>

      <div className="split">
        <EntitySection id="specs" title="Specifications">
          <Facts
            items={[
              ['Vendor', device.vendor.name],
              ['Type', kindLabel],
              ['Memory', device.memoryKind === 'dedicated' ? formatGb(device.memoryGb) : device.memoryKind === 'unified' ? 'Unified (per system)' : 'Uses system RAM'],
              ['Memory type', device.memoryType],
              ['Bandwidth', device.memoryBandwidthGbps ? `${device.memoryBandwidthGbps} GB/s` : '—'],
              ['GPU-usable share', device.memoryKind === 'unified' ? `${Math.round((device.unifiedUsableFraction ?? 0.75) * 100)}% by default` : '—'],
              ['Backends', device.backends.map((b) => `${b} (${BACKEND_LABEL[b] ?? b})`).join(', ')],
              ['TDP', device.tdpWatts ? `${device.tdpWatts} W` : '—'],
              ['Released', formatDate(device.releasedOn)],
              ['Launch price', device.launchPriceUsd ? `$${device.launchPriceUsd.toLocaleString('en-US')}` : '—'],
            ]}
          />
          {device.successors.length > 0 && (
            <p className="small muted" style={{ marginTop: 10 }}>
              {device.successors.map((s, i) => <span key={s.slug}>{i > 0 && ' · '}{s.direction === 'newer' ? 'Succeeded by' : 'Successor to'} <Link className="link" href={`/hardware/${s.slug}`}>{s.name}</Link></span>)}
            </p>
          )}
        </EntitySection>
        <EntitySection id="sources" title="Sources & history">
          <ProvenanceBlock provenance={provenance} />
          {events.length > 0 && <ul className="list-plain" style={{ marginTop: 8 }}>{events.map((e) => <li key={e.id} className="small"><span className="num muted">{formatDate(e.occurredAt)}</span> {e.title}</li>)}</ul>}
        </EntitySection>
      </div>
    </>
  );
}
