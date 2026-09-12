import { catalog, getDb } from '@mutinai/db';
import { COMPUTE_BACKENDS, DEVICE_KINDS } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, PageHead, Tag } from '@/components/ui';
import { formatDate, formatGb, humanize, searchParam } from '@/lib/format';

export const metadata: Metadata = { title: 'Hardware' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function HardwarePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const view = searchParam(sp, 'view') === 'systems' ? 'systems' : 'devices';
  const db = getDb();
  const filters: catalog.DeviceListFilters = {
    q: searchParam(sp, 'q'),
    kind: searchParam(sp, 'kind'),
    vendor: searchParam(sp, 'vendor'),
    backend: searchParam(sp, 'backend'),
    memoryKind: searchParam(sp, 'memory'),
    sort: (searchParam(sp, 'sort') as catalog.DeviceListFilters['sort']) ?? 'bandwidth',
  };
  const [devices, systems, vendors] = await Promise.all([
    view === 'devices' ? catalog.listDevices(db, filters) : Promise.resolve([]),
    view === 'systems' ? catalog.listConfigurations(db) : Promise.resolve([]),
    catalog.listHardwareVendors(db),
  ]);

  return (
    <>
      <PageHead
        eyebrow="Directory"
        title="Hardware"
        lede="Devices are individual products. Systems are assembled configurations — GPUs, CPUs, memory — that compatibility and benchmark results are measured against."
      >
        <nav className="tags" aria-label="Hardware views">
          <Link className="btn btn-small" aria-current={view === 'devices' ? 'page' : undefined} href="/hardware">Devices</Link>
          <Link className="btn btn-small" aria-current={view === 'systems' ? 'page' : undefined} href="/hardware?view=systems">Systems</Link>
        </nav>
      </PageHead>

      {view === 'devices' ? (
        <>
          <form className="filters" action="/hardware">
            <label className="field"><span>Search</span><input type="search" name="q" defaultValue={filters.q} placeholder="RTX, M4, Ryzen…" /></label>
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
              <span>Backend</span>
              <select name="backend" defaultValue={filters.backend ?? ''}>
                <option value="">Any</option>
                {COMPUTE_BACKENDS.map((b) => <option key={b} value={b}>{b}</option>)}
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
              <span>Sort</span>
              <select name="sort" defaultValue={filters.sort}>
                <option value="bandwidth">Memory bandwidth</option>
                <option value="memory">Memory size</option>
                <option value="released">Newest</option>
                <option value="name">Name</option>
              </select>
            </label>
            <button className="btn btn-primary" type="submit">Apply</button>
          </form>
          <p className="small muted">{devices.length} devices · Memory bandwidth largely determines generation speed; memory size determines what fits.</p>
          {devices.length === 0 ? <Empty>No devices match.</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Device</th><th>Type</th><th className="r">Memory</th><th className="r">Bandwidth</th><th>Backends</th>
                    <th className="r">TDP</th><th>Released</th><th className="r">Launch price</th><th className="r">Systems</th><th className="r">Results</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr key={d.slug}>
                      <td><Link className="primary" href={`/hardware/${d.slug}`}>{d.name}</Link><span className="sub">{d.vendor.name}</span></td>
                      <td>{d.deviceKind === 'soc' ? 'SoC / APU' : humanize(d.deviceKind)}</td>
                      <td className="r num">
                        {d.memoryKind === 'dedicated' ? formatGb(d.memoryGb) : d.memoryKind === 'unified' ? 'Unified' : 'System RAM'}
                        {d.memoryType && <span className="sub">{d.memoryType}</span>}
                      </td>
                      <td className="r num">{d.memoryBandwidthGbps ? `${d.memoryBandwidthGbps} GB/s` : '—'}</td>
                      <td><div className="tags">{d.backends.map((b) => <Tag key={b}>{b}</Tag>)}</div></td>
                      <td className="r num">{d.tdpWatts ? `${d.tdpWatts} W` : '—'}</td>
                      <td className="num">{formatDate(d.releasedOn)}</td>
                      <td className="r num">{d.launchPriceUsd ? `$${d.launchPriceUsd.toLocaleString('en-US')}` : '—'}</td>
                      <td className="r num">{d.configurationCount}</td>
                      <td className="r num">{d.resultCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>System</th><th>Form factor</th><th className="r">Accelerator memory</th><th className="r">System RAM</th><th className="r">Approx. price</th><th className="r">Measurements</th><th /></tr>
            </thead>
            <tbody>
              {systems.map((c) => (
                <tr key={c.slug}>
                  <td><Link className="primary" href={`/hardware/systems/${c.slug}`}>{c.name}</Link><span className="sub">{c.components.map((x) => `${x.count > 1 ? `${x.count}× ` : ''}${x.name}`).join(' + ')}</span></td>
                  <td>{humanize(c.formFactor)}</td>
                  <td className="r num">{formatGb(c.acceleratorMemoryGb)}{c.unifiedMemoryGb ? ' unified' : ''}</td>
                  <td className="r num">{c.systemRamGb ? formatGb(c.systemRamGb) : '—'}</td>
                  <td className="r num">{c.approxPriceUsd ? `$${c.approxPriceUsd.toLocaleString('en-US')}` : '—'}</td>
                  <td className="r num">{c.resultCount}</td>
                  <td className="r"><Link className="btn btn-small" href={`/run?system=${c.slug}`}>What runs?</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
