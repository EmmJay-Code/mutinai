import { catalog, community, getDb } from '@mutinai/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PerformanceTable, RatingSummary, ReviewList, SubmissionTable } from '@/components/results';
import { Facts, PageHead, Section } from '@/components/ui';
import { formatGb, humanize } from '@/lib/format';
import { getViewer } from '@/lib/session';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const c = await catalog.getConfigurationDetail(getDb(), (await params).slug);
  return { title: c?.name ?? 'System not found' };
}

export default async function SystemPage({ params }: { params: Params }) {
  const { slug } = await params;
  const db = getDb();
  const system = await catalog.getConfigurationDetail(db, slug);
  if (!system) notFound();
  const viewer = await getViewer();
  const [reviews, aggregates, submissions] = await Promise.all([
    community.listReviewsForEntities(db, [system.id], viewer),
    community.ratingAggregates(db, [system.id]),
    community.listSubmissions(db, { configurationId: system.id }, viewer),
  ]);

  return (
    <>
      <PageHead
        crumbs={[{ href: '/hardware', label: 'Hardware' }, { href: '/hardware?view=systems', label: 'Systems' }]}
        eyebrow={`Reference system · ${humanize(system.formFactor)}`}
        title={system.name}
        lede={system.summary}
      >
        <Link className="btn btn-primary btn-small" href={`/run?system=${system.slug}`}>What can this run?</Link>
        <Link className="btn btn-small" href={`/contribute/benchmark?system=${system.slug}`}>Submit a run</Link>
        <Link className="btn btn-small" href={`/contribute/review?entity=hardware_configuration:${system.slug}&returnTo=/hardware/systems/${system.slug}`}>Review</Link>
      </PageHead>

      <div className="grid grid-main-aside">
        <div>
          <Facts
            items={[
              ['Components', system.components.map((c) => `${c.count > 1 ? `${c.count}× ` : ''}${c.name}`).join(' + ')],
              [system.unifiedMemoryGb ? 'Unified memory' : 'Accelerator memory', formatGb(system.acceleratorMemoryGb)],
              ['System RAM', system.systemRamGb ? formatGb(system.systemRamGb) : 'Shared (unified)'],
              ['RAM bandwidth', system.systemRamBandwidthGbps ? `${system.systemRamBandwidthGbps} GB/s` : '—'],
              ['Approx. price', system.approxPriceUsd ? `$${system.approxPriceUsd.toLocaleString('en-US')}` : '—'],
            ]}
          />
          <Section title="Components">
            <ul className="list-plain panel panel-pad">
              {system.components.map((c) => (
                <li key={c.slug}>
                  <span className="num">{c.count}×</span> <Link href={`/hardware/${c.slug}`}>{c.name}</Link>{' '}
                  <span className="small muted">{humanize(c.deviceKind)}{c.memoryGb ? ` · ${formatGb(c.memoryGb)}` : ''}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Measured performance">
            <PerformanceTable results={system.performanceResults} showModel showSystem={false} />
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
        </aside>
      </div>
    </>
  );
}
