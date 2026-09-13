import { catalog, getDb } from '@mutinai/db';
import { compat, COMPUTE_BACKENDS, DEVICE_KINDS } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty } from '@/components/ui';
import { LinearBar, MemoryScale, ParamsReach } from '@/components/viz';
import { formatGb, humanize, searchParam } from '@/lib/format';
import { BACKEND_LABEL, DEVICE_KIND_LABEL, maxParamsAtQ4, pricePerGb, systemUsableGb } from '@/lib/hardware';

export const metadata: Metadata = { title: 'Hardware' };

type SP = Promise<Record<string, string | string[] | undefined>>;

const KEYS = ['view', 'q', 'kind', 'vendor', 'backend', 'memory', 'sort', 'min'] as const;

const QUICK = [
  { label: 'GPUs', key: 'kind', value: 'gpu' },
  { label: 'Apple silicon', key: 'vendor', value: 'apple' },
  { label: 'Unified memory', key: 'memory', value: 'unified' },
  { label: '24 GB+', key: 'min', value: '24' },
  { label: 'CPU only', key: 'kind', value: 'cpu' },
];

const shortName = (n: string) => n.replace(/^(NVIDIA|AMD|Apple)\s+(GeForce\s+|Radeon\s+)?/, '');

export default async function HardwarePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = Object.fromEntries(KEYS.flatMap((k) => (searchParam(sp, k) ? [[k, searchParam(sp, k)!]] : []))) as Record<string, string>;
  const view = current.view === 'systems' ? 'systems' : 'devices';
  const db = getDb();
  const filters: catalog.DeviceListFilters = {
    q: current.q, kind: current.kind, vendor: current.vendor, backend: current.backend, memoryKind: current.memory,
    sort: (current.sort as catalog.DeviceListFilters['sort']) ?? 'bandwidth',
  };
  const [allDevices, systems, vendors, everyDevice] = await Promise.all([
    catalog.listDevices(db, filters),
    catalog.listConfigurations(db),
    catalog.listHardwareVendors(db),
    catalog.listDevices(db),
  ]);
  const min = Number(current.min);
  const devices = Number.isFinite(min) && min > 0 ? allDevices.filter((d) => (d.memoryGb ?? 0) >= min) : allDevices;
  const maxBandwidth = Math.max(...everyDevice.map((d) => d.memoryBandwidthGbps ?? 0));
  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams({ ...current });
    for (const [k, v] of Object.entries(changes)) (v == null ? next.delete(k) : next.set(k, v));
    const s = next.toString();
    return s ? `/hardware?${s}` : '/hardware';
  };

  return (
    <>
      <div className="dir-head">
        <h1><span className={`glyph ${view === 'systems' ? 'g-system' : 'g-hardware'}`} aria-hidden="true" /> Hardware</h1>
        <span className="count">{view === 'devices' ? `${devices.length} devices` : `${systems.length} reference systems`}</span>
        {view === 'devices' && (
          <form className="dir-search" action="/hardware" role="search">
            <label className="sr-only" htmlFor="hw-q">Search hardware</label>
            <input id="hw-q" type="search" name="q" defaultValue={filters.q} placeholder="RTX, M4, Ryzen…" />
            <button type="submit">Search</button>
          </form>
        )}
      </div>

      <div className="dir-bar">
        <div className="chips" aria-label="View">
          <Link className="chip" aria-current={view === 'devices'} href="/hardware">Devices</Link>
          <Link className="chip" aria-current={view === 'systems'} href="/hardware?view=systems">Systems</Link>
        </div>
        {view === 'devices' && (
          <>
            <span className="divider" aria-hidden="true" />
            <div className="chips" aria-label="Quick filters">
              {QUICK.map((q) => {
                const on = current[q.key] === q.value;
                return <Link key={q.label} className="chip" aria-pressed={on} href={href({ [q.key]: on ? null : q.value })}>{q.label}</Link>;
              })}
            </div>
            <details className="filter-panel">
              <summary className="chip">More filters</summary>
              <form action="/hardware" className="filter-body">
                {filters.q && <input type="hidden" name="q" value={filters.q} />}
                <label className="field"><span>Type</span>
                  <select name="kind" defaultValue={filters.kind ?? ''}><option value="">Any</option>{DEVICE_KINDS.map((k) => <option key={k} value={k}>{DEVICE_KIND_LABEL[k] ?? humanize(k)}</option>)}</select>
                </label>
                <label className="field"><span>Vendor</span>
                  <select name="vendor" defaultValue={filters.vendor ?? ''}><option value="">Any</option>{vendors.map((v) => <option key={v.slug} value={v.slug}>{v.name}</option>)}</select>
                </label>
                <label className="field"><span>Works with</span>
                  <select name="backend" defaultValue={filters.backend ?? ''}><option value="">Any</option>{COMPUTE_BACKENDS.map((b) => <option key={b} value={b}>{b} · {BACKEND_LABEL[b]}</option>)}</select>
                </label>
                <label className="field"><span>Memory</span>
                  <select name="memory" defaultValue={filters.memoryKind ?? ''}><option value="">Any</option><option value="dedicated">Dedicated VRAM</option><option value="unified">Unified</option><option value="none">System RAM (CPU)</option></select>
                </label>
                <label className="field"><span>Minimum memory (GB)</span><input type="number" name="min" min="0" defaultValue={current.min} /></label>
                <div className="tags"><button className="btn btn-primary" type="submit">Apply</button><Link className="btn" href="/hardware">Reset</Link></div>
              </form>
            </details>
            <span className="spacer" />
            <form action="/hardware" className="tags">
              {Object.entries(current).filter(([k]) => k !== 'sort').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <label className="small muted" htmlFor="hw-sort">Sort</label>
              <select id="hw-sort" name="sort" defaultValue={filters.sort}>
                <option value="bandwidth">Fastest memory</option><option value="memory">Most memory</option><option value="released">Newest</option><option value="name">Name</option>
              </select>
              <button className="btn btn-small" type="submit">Sort</button>
            </form>
          </>
        )}
      </div>

      {view === 'devices' ? (
        devices.length === 0 ? <Empty>No devices match. <Link className="link" href="/hardware">Clear filters</Link>.</Empty> : (
          <>
            <div className="index-head hardware-grid" aria-hidden="true"><span /><span>Device</span><span>Memory</span><span>Memory speed</span><span>Holds at 4-bit</span><span>Value · results</span></div>
            <ul className="list-plain">
              {devices.map((d) => {
                const usable = d.memoryKind === 'dedicated' && d.memoryGb ? d.memoryGb * compat.COMPAT_CONSTANTS.dedicatedUsableFraction : null;
                const ppg = pricePerGb(d.launchPriceUsd, d.memoryGb);
                return (
                  <li className="index-row hardware-grid" key={d.slug} style={{ borderTop: 0 }}>
                    <span className="glyph g-hardware" aria-hidden="true" />
                    <div>
                      <div className="name"><Link href={`/hardware/${d.slug}`}>{d.name}</Link></div>
                      <div className="sub">{d.vendor.name} · {DEVICE_KIND_LABEL[d.deviceKind] ?? humanize(d.deviceKind)}{d.releasedOn ? ` · ${d.releasedOn.slice(0, 4)}` : ''}{d.memoryType ? ` · ${d.memoryType}` : ''}</div>
                      <div className="desc">Works with {[...new Set(d.backends.map((b) => BACKEND_LABEL[b] ?? b))].join(', ')}</div>
                    </div>
                    <div>
                      <span className="cell-label">Memory</span>
                      {d.memoryKind === 'dedicated' ? <MemoryScale gb={d.memoryGb} label="VRAM" exact /> : <div className="small"><span className="muted">{d.memoryKind === 'unified' ? 'Unified' : 'System RAM'}</span><div className="small faint">set per system</div></div>}
                    </div>
                    <div><span className="cell-label">Memory speed</span><LinearBar value={d.memoryBandwidthGbps} max={maxBandwidth} label="GB/s" display={d.memoryBandwidthGbps ? d.memoryBandwidthGbps.toLocaleString('en-US') : '—'} /></div>
                    <div><span className="cell-label">Holds at 4-bit</span>{usable ? <ParamsReach maxB={maxParamsAtQ4(usable)} label="up to" /> : <span className="small muted">{d.memoryKind === 'unified' ? 'depends on system' : 'depends on RAM'}</span>}</div>
                    <div className="small">
                      <span className="cell-label">Value · results</span>
                      {ppg ? <div><span className="num">${ppg}</span> <span className="muted">/ GB</span></div> : <div className="faint">no price</div>}
                      <div className="muted">{d.resultCount ? `${d.resultCount} measurements` : 'no measurements'}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )
      ) : (
        <>
          <div className="index-head systems-grid" aria-hidden="true"><span /><span>System</span><span>Usable memory</span><span>Holds at 4-bit</span><span>Price</span></div>
          <ul className="list-plain">
            {systems.map((c) => {
              const usable = systemUsableGb(c);
              return (
                <li className="index-row systems-grid" key={c.slug} style={{ borderTop: 0 }}>
                  <span className="glyph g-system" aria-hidden="true" />
                  <div>
                    <div className="name"><Link href={`/hardware/systems/${c.slug}`}>{c.name}</Link></div>
                    <div className="sub">{humanize(c.formFactor)} · {c.components.map((x) => `${x.count > 1 ? `${x.count}× ` : ''}${shortName(x.name)}`).join(' + ')}</div>
                    <div className="desc"><Link className="link" href={`/run?system=${c.slug}`}>What can it run?</Link>{c.resultCount ? <span className="muted"> · {c.resultCount} measurements</span> : null}</div>
                  </div>
                  <div><span className="cell-label">Usable memory</span><MemoryScale gb={usable.gb} label={usable.where === 'ram' ? 'RAM' : usable.where === 'unified' ? 'unified' : 'GPU'} /></div>
                  <div><span className="cell-label">Holds at 4-bit</span><ParamsReach maxB={maxParamsAtQ4(usable.gb)} label="up to" /></div>
                  <div className="small"><span className="cell-label">Price</span>{c.approxPriceUsd ? <><span className="num">~${c.approxPriceUsd.toLocaleString('en-US')}</span><div className="muted">{formatGb(c.acceleratorMemoryGb || c.systemRamGb)} total</div></> : <span className="faint">—</span>}</div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
