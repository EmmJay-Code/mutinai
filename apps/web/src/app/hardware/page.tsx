import { catalog, getDb } from '@mutinai/db';
import { COMPUTE_BACKENDS, DEVICE_KINDS } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty } from '@/components/ui';
import { formatGb, humanize, searchParam } from '@/lib/format';
import { BACKEND_LABEL, DEVICE_KIND_LABEL, deviceSentence, systemSentence } from '@/lib/hardware';

export const metadata: Metadata = { title: 'Hardware' };

type SP = Promise<Record<string, string | string[] | undefined>>;

const KEYS = ['view', 'q', 'kind', 'vendor', 'backend', 'memory', 'sort', 'min'] as const;

const QUICK = [
  { label: 'GPUs', key: 'kind', value: 'gpu' },
  { label: 'Apple silicon', key: 'vendor', value: 'apple' },
  { label: 'Unified memory', key: 'memory', value: 'unified' },
  { label: '24 GB or more', key: 'min', value: '24' },
  { label: 'CPU only', key: 'kind', value: 'cpu' },
];

export default async function HardwarePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = Object.fromEntries(KEYS.flatMap((k) => (searchParam(sp, k) ? [[k, searchParam(sp, k)!]] : []))) as Record<string, string>;
  const view = current.view === 'systems' ? 'systems' : 'devices';
  const db = getDb();
  const filters: catalog.DeviceListFilters = {
    q: current.q,
    kind: current.kind,
    vendor: current.vendor,
    backend: current.backend,
    memoryKind: current.memory,
    sort: (current.sort as catalog.DeviceListFilters['sort']) ?? 'bandwidth',
  };
  const [allDevices, systems, vendors] = await Promise.all([
    view === 'devices' ? catalog.listDevices(db, filters) : Promise.resolve([]),
    view === 'systems' ? catalog.listConfigurations(db) : Promise.resolve([]),
    catalog.listHardwareVendors(db),
  ]);
  const min = Number(current.min);
  const devices = Number.isFinite(min) && min > 0 ? allDevices.filter((d) => (d.memoryGb ?? 0) >= min) : allDevices;
  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams({ ...current });
    for (const [k, v] of Object.entries(changes)) (v == null ? next.delete(k) : next.set(k, v));
    const s = next.toString();
    return s ? `/hardware?${s}` : '/hardware';
  };
  const advanced = ['backend', 'sort'].some((k) => current[k]) || (current.vendor && current.vendor !== 'apple') || current.memory === 'dedicated' || current.memory === 'none' || current.kind === 'soc' || current.kind === 'accelerator';

  return (
    <>
      <div className="discover-head">
        <div className="eyebrow">Hardware</div>
        <h1>Find hardware for running AI.</h1>
        <p className="lede" style={{ marginTop: 'var(--s3)' }}>For local models, two numbers matter most: how much memory a device has, and how fast it can read it.</p>
        <div className="chips quick-filters" role="tablist" aria-label="View">
          <Link className="chip" aria-current={view === 'devices'} href="/hardware">Devices</Link>
          <Link className="chip" aria-current={view === 'systems'} href="/hardware?view=systems">Complete systems</Link>
        </div>
      </div>

      {view === 'devices' ? (
        <>
          <form className="searchbar" action="/hardware" role="search" style={{ marginTop: 0 }}>
            <label className="sr-only" htmlFor="hw-q">Search hardware</label>
            <input id="hw-q" type="search" name="q" defaultValue={filters.q} placeholder="RTX, M4, Ryzen…" />
            <button className="btn btn-primary" type="submit">Search</button>
          </form>
          <div className="chips quick-filters" aria-label="Quick filters">
            {QUICK.map((q) => {
              const on = current[q.key] === q.value;
              return <Link key={q.label} className="chip" aria-pressed={on} href={href({ [q.key]: on ? null : q.value })}>{q.label}</Link>;
            })}
          </div>

          <div className="toolbar" style={{ marginTop: 'var(--s5)' }}>
            <span className="count">{devices.length} device{devices.length === 1 ? '' : 's'}</span>
            <details className="filter-panel" open={Boolean(advanced)}>
              <summary className="btn btn-small">Filters & sorting</summary>
              <form action="/hardware" className="filter-body" style={{ position: 'absolute', right: 0, zIndex: 5, width: 'min(720px, 90vw)' }}>
                {filters.q && <input type="hidden" name="q" value={filters.q} />}
                <label className="field">
                  <span>Type</span>
                  <select name="kind" defaultValue={filters.kind ?? ''}>
                    <option value="">Any</option>
                    {DEVICE_KINDS.map((k) => <option key={k} value={k}>{k === 'soc' ? 'SoC / APU' : humanize(k)}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Vendor</span>
                  <select name="vendor" defaultValue={filters.vendor ?? ''}>
                    <option value="">Any</option>
                    {vendors.map((v) => <option key={v.slug} value={v.slug}>{v.name}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Works with</span>
                  <select name="backend" defaultValue={filters.backend ?? ''}>
                    <option value="">Any</option>
                    {COMPUTE_BACKENDS.map((b) => <option key={b} value={b}>{b} ({BACKEND_LABEL[b]})</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Memory</span>
                  <select name="memory" defaultValue={filters.memoryKind ?? ''}>
                    <option value="">Any</option>
                    <option value="dedicated">Dedicated VRAM</option>
                    <option value="unified">Unified</option>
                    <option value="none">System RAM (CPU)</option>
                  </select>
                </label>
                <label className="field">
                  <span>Minimum memory (GB)</span>
                  <input type="number" name="min" min="0" defaultValue={current.min} />
                </label>
                <label className="field">
                  <span>Sort</span>
                  <select name="sort" defaultValue={filters.sort}>
                    <option value="bandwidth">Fastest memory</option>
                    <option value="memory">Most memory</option>
                    <option value="released">Newest</option>
                    <option value="name">Name</option>
                  </select>
                </label>
                <div className="tags"><button className="btn btn-primary" type="submit">Apply</button><Link className="btn" href="/hardware">Reset</Link></div>
              </form>
            </details>
          </div>

          {devices.length === 0 ? <Empty>No devices match. <Link href="/hardware">Clear filters</Link>.</Empty> : (
            <ul className="result-list">
              {devices.map((d) => (
                <li className="result" key={d.slug}>
                  <div>
                    <h3><Link href={`/hardware/${d.slug}`}>{d.name}</Link></h3>
                    <div className="by">{d.vendor.name} · {DEVICE_KIND_LABEL[d.deviceKind] ?? humanize(d.deviceKind)}{d.releasedOn ? ` · ${d.releasedOn.slice(0, 4)}` : ''}</div>
                    <p className="desc">{deviceSentence(d)}</p>
                    <div className="small muted">Works with {d.backends.map((b) => BACKEND_LABEL[b] ?? b).filter((x, i, a) => a.indexOf(x) === i).join(', ')}</div>
                  </div>
                  <div className="result-side">
                    <div>
                      <div className="big">{d.memoryKind === 'dedicated' ? formatGb(d.memoryGb) : d.memoryKind === 'unified' ? 'Unified' : 'System RAM'}</div>
                      <div className="small muted">{d.memoryBandwidthGbps ? `${d.memoryBandwidthGbps.toLocaleString('en-US')} GB/s memory` : 'memory'}</div>
                    </div>
                    {d.launchPriceUsd && <div className="small">${d.launchPriceUsd.toLocaleString('en-US')} at launch</div>}
                    {d.configurationCount > 0 && <div className="small muted">In {d.configurationCount} reference system{d.configurationCount === 1 ? '' : 's'}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <ul className="result-list">
          {systems.map((c) => (
            <li className="result" key={c.slug}>
              <div>
                <h3><Link href={`/hardware/systems/${c.slug}`}>{c.name}</Link></h3>
                <div className="by">{humanize(c.formFactor)} · {c.components.map((x) => `${x.count > 1 ? `${x.count}× ` : ''}${x.name}`).join(' + ')}</div>
                <p className="desc">{systemSentence(c)}</p>
                <div className="result-actions"><Link href={`/run?system=${c.slug}`}>What can it run? →</Link></div>
              </div>
              <div className="result-side">
                <div>
                  <div className="big">{formatGb(c.acceleratorMemoryGb || c.systemRamGb)}</div>
                  <div className="small muted">{c.unifiedMemoryGb ? 'unified memory' : c.acceleratorMemoryGb ? 'GPU memory' : 'system RAM'}</div>
                </div>
                {c.approxPriceUsd && <div className="small">about ${c.approxPriceUsd.toLocaleString('en-US')}</div>}
                {c.resultCount > 0 && <div className="small muted">{c.resultCount} measurements</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
