import { catalog, getDb } from '@mutinai/db';
import { compat, COMPUTE_BACKENDS, DEVICE_KINDS, deviceCategory, deviceClassLabel, devicePositioning, formatPrice, HARDWARE_CATEGORIES, HARDWARE_GOALS, hardwareGoal, systemCategories, systemClassLabel, systemMatchesGoal, systemPositioning, type HardwareCategory, type PriceQuote } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PathIcon } from '@/components/icons';
import { InfoModeToggle } from '@/components/info-mode';
import { Empty } from '@/components/ui';
import { LinearBar, MemoryScale, ParamsReach } from '@/components/viz';
import { formatGb, humanize, searchParam } from '@/lib/format';
import { BACKEND_LABEL, DEVICE_KIND_LABEL, devicePrice, gpuCount, maxParamsAtQ4, pricePerGb, roughParams, systemPrice, systemUsableGb } from '@/lib/hardware';
import { getInfoMode } from '@/lib/info-mode';

export const metadata: Metadata = { title: 'Hardware' };

type SP = Promise<Record<string, string | string[] | undefined>>;
type Category = 'all' | HardwareCategory;

const KEYS = ['cat', 'goal', 'view', 'q', 'kind', 'vendor', 'backend', 'memory', 'sort', 'min'] as const;
const DEVICE_FILTER_KEYS = ['q', 'kind', 'vendor', 'backend', 'memory', 'min'];
const CATEGORIES: { key: Category; label: string }[] = [{ key: 'all', label: 'All hardware' }, ...HARDWARE_CATEGORIES];

const shortName = (n: string) => n.replace(/^(NVIDIA|AMD|Apple)\s+(GeForce\s+|Radeon\s+)?/, '');

export default async function HardwarePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = Object.fromEntries(KEYS.flatMap((k) => (searchParam(sp, k) ? [[k, searchParam(sp, k)!]] : []))) as Record<string, string>;
  const goal = hardwareGoal(current.goal);
  if (!goal) delete current.goal;
  // `view=systems` is the previous URL shape for the systems list; keep it working.
  const cat: Category = CATEGORIES.some((c) => c.key === current.cat) ? (current.cat as Category) : goal?.category ?? (current.view === 'systems' ? 'systems' : 'all');
  const db = getDb();
  const filters: catalog.DeviceListFilters = {
    q: current.q, kind: current.kind, vendor: current.vendor, backend: current.backend, memoryKind: current.memory,
    sort: (current.sort as catalog.DeviceListFilters['sort']) ?? (goal?.key === 'upgrade' ? 'memory' : 'bandwidth'),
  };
  const [matchingDevices, allSystems, vendors, everyDevice, mode] = await Promise.all([
    catalog.listDevices(db, filters),
    catalog.listConfigurations(db),
    catalog.listHardwareVendors(db),
    catalog.listDevices(db),
    getInfoMode(),
  ]);
  const min = Number(current.min);
  const filtered = Number.isFinite(min) && min > 0 ? matchingDevices.filter((d) => (d.memoryGb ?? 0) >= min) : matchingDevices;
  const deviceFilterActive = DEVICE_FILTER_KEYS.some((k) => current[k]);

  const devices = cat === 'systems' ? [] : filtered.filter((d) => cat === 'all' || deviceCategory(d) === cat);
  let systems = cat === 'gpu' ? [] : allSystems.filter((c) => cat === 'all' || systemCategories(c).includes(cat));
  if (deviceFilterActive) {
    // Systems follow the device filters: show systems built from a matching device (or named like the search).
    const slugs = new Set(filtered.map((d) => d.slug));
    systems = systems.filter((c) => c.components.some((x) => slugs.has(x.slug)) || (!!current.q && c.name.toLowerCase().includes(current.q.toLowerCase())));
  }
  if (goal) systems = systems.filter((c) => systemMatchesGoal(goal, c, systemUsableGb(c).gb));
  if (goal?.key === 'first') systems = [...systems].sort((a, b) => (a.approxPriceUsd ?? Infinity) - (b.approxPriceUsd ?? Infinity));
  if (goal?.key === 'workstation') systems = [...systems].sort((a, b) => systemUsableGb(b).gb - systemUsableGb(a).gb);

  const maxBandwidth = Math.max(...everyDevice.map((d) => d.memoryBandwidthGbps ?? 0));
  const simple = mode === 'simple';
  const exploring = !goal && cat === 'all' && !deviceFilterActive;
  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams({ ...current });
    for (const [k, v] of Object.entries(changes)) (v == null ? next.delete(k) : next.set(k, v));
    const s = next.toString();
    return s ? `/hardware?${s}` : '/hardware';
  };
  const catHref = (key: Category) => `${href({ cat: key === 'all' ? null : key, goal: null, view: null })}#catalog`;
  const query = new URLSearchParams(current).toString();
  const returnTo = `/hardware${query ? `?${query}` : ''}#catalog`;
  const heading = goal?.label ?? CATEGORIES.find((c) => c.key === cat)!.label;

  return (
    <>
      <div className="dir-head">
        <h1><span className="glyph g-hardware" aria-hidden="true" /> Hardware</h1>
        <span className="count">{everyDevice.length} devices · {allSystems.length} reference systems</span>
        <form className="dir-search" action="/hardware" role="search">
          {Object.entries(current).filter(([k]) => k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="sr-only" htmlFor="hw-q">Search hardware</label>
          <input id="hw-q" type="search" name="q" defaultValue={filters.q} placeholder="RTX, M4, Ryzen…" />
          <button type="submit">Search</button>
        </form>
      </div>

      {simple && exploring && (
        <div className="discovery">
          <section className="intents" aria-labelledby="goals-h">
            <div className="intents-head">
              <h2 id="goals-h">What are you trying to do?</h2>
              <a className="small muted" href="#catalog">Skip to all hardware ↓</a>
            </div>
            <ul className="intent-grid five">
              {HARDWARE_GOALS.map((g) => (
                <li key={g.key}>
                  <Link className="intent" href={`/hardware?goal=${g.key}#catalog`}>
                    <PathIcon name={g.key} />
                    <strong>{g.label}</strong>
                    <span className="hint">{g.hint}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <div className={`catalog-head${simple && exploring ? ' after-discovery' : ''}`} id="catalog">
        <h2>
          {goal ? <><PathIcon name={goal.key} /> {heading}</> : heading}
          <span className="count" aria-live="polite">{[devices.length ? `${devices.length} device${devices.length === 1 ? '' : 's'}` : null, systems.length ? `${systems.length} system${systems.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'none'}</span>
        </h2>
        <InfoModeToggle mode={mode} returnTo={returnTo} />
      </div>
      {goal && (
        <p className="intent-explain">
          <span>{goal.explain}</span>
          <Link className="link" href="/hardware#catalog">Show all hardware</Link>
        </p>
      )}

      <div className="dir-bar">
        <div className="chips" aria-label="Category">
          {CATEGORIES.map((c) => <Link key={c.key} className="chip" aria-current={cat === c.key && !goal} href={catHref(c.key)}>{c.label}</Link>)}
        </div>
        <details className="filter-panel">
          <summary className="chip">{simple ? 'Filters' : 'More filters'}</summary>
          <form action="/hardware" className="filter-body">
            {filters.q && <input type="hidden" name="q" value={filters.q} />}
            {current.cat && <input type="hidden" name="cat" value={current.cat} />}
            {goal && <input type="hidden" name="goal" value={goal.key} />}
            <label className="field"><span>Type</span>
              <select name="kind" defaultValue={filters.kind ?? ''}><option value="">Any</option>{DEVICE_KINDS.map((k) => <option key={k} value={k}>{DEVICE_KIND_LABEL[k] ?? humanize(k)}</option>)}</select>
            </label>
            <label className="field"><span>Manufacturer</span>
              <select name="vendor" defaultValue={filters.vendor ?? ''}><option value="">Any</option>{vendors.map((v) => <option key={v.slug} value={v.slug}>{v.name}</option>)}</select>
            </label>
            <label className="field"><span>Works with</span>
              <select name="backend" defaultValue={filters.backend ?? ''}><option value="">Any</option>{COMPUTE_BACKENDS.map((b) => <option key={b} value={b}>{b} · {BACKEND_LABEL[b]}</option>)}</select>
            </label>
            <label className="field"><span>Memory</span>
              <select name="memory" defaultValue={filters.memoryKind ?? ''}><option value="">Any</option><option value="dedicated">Dedicated VRAM</option><option value="unified">Unified</option><option value="none">System RAM (CPU)</option></select>
            </label>
            <label className="field"><span>Minimum memory (GB)</span><input type="number" name="min" min="0" defaultValue={current.min} /></label>
            <div className="tags"><button className="btn btn-primary" type="submit">Apply</button><Link className="btn" href="/hardware#catalog">Reset</Link></div>
          </form>
        </details>
        <span className="spacer" />
        {devices.length > 0 && (
          <form action="/hardware" className="tags">
            {Object.entries(current).filter(([k]) => k !== 'sort').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label className="small muted" htmlFor="hw-sort">Sort devices</label>
            <select id="hw-sort" name="sort" defaultValue={filters.sort}>
              <option value="bandwidth">Fastest memory</option><option value="memory">Most memory</option><option value="released">Newest</option><option value="name">Name</option>
            </select>
            <button className="btn btn-small" type="submit">Sort</button>
          </form>
        )}
      </div>

      {devices.length === 0 && systems.length === 0 && <Empty>No hardware matches. <Link className="link" href="/hardware#catalog">Clear filters</Link>.</Empty>}

      {devices.length > 0 && (
        <section aria-labelledby="devices-h">
          {systems.length > 0 && <h3 className="list-title" id="devices-h">{cat === 'server' ? 'Accelerators' : cat === 'unified' ? 'Chips' : 'Devices'} <span className="num">{devices.length}</span></h3>}
          {simple ? (
            <ul className="hw-grid">{devices.map((d) => <DeviceCard key={d.slug} d={d} />)}</ul>
          ) : (
            <>
              <div className="index-head hardware-grid" aria-hidden="true"><span /><span>Device</span><span>Memory</span><span>Memory speed</span><span>Holds at 4-bit</span><span>Launch $/GB · results</span></div>
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
                        <span className="cell-label">Launch $/GB · results</span>
                        {ppg ? <div title="Launch price (MSRP) divided by memory"><span className="num">${ppg}</span> <span className="muted">/ GB MSRP</span></div> : <div className="faint">no launch price</div>}
                        <div className="muted">{d.resultCount ? `${d.resultCount} measurements` : 'no measurements'}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {systems.length > 0 && (
        <section aria-labelledby="systems-h">
          {devices.length > 0 && <h3 className="list-title" id="systems-h">{cat === 'server' ? 'Servers & multi-GPU builds' : cat === 'unified' ? 'Systems built on them' : 'Reference systems'} <span className="num">{systems.length}</span></h3>}
          {simple ? (
            <ul className="hw-grid">{systems.map((c) => <SystemCard key={c.slug} c={c} />)}</ul>
          ) : (
            <>
              <div className="index-head systems-grid" aria-hidden="true"><span /><span>System</span><span>Usable memory</span><span>Holds at 4-bit</span><span>Estimated cost</span></div>
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
                      <div className="small"><span className="cell-label">Estimated cost</span>{c.approxPriceUsd ? <><span className="num" title="Editorial estimate of the build cost, not a quoted price">~${c.approxPriceUsd.toLocaleString('en-US')}</span><div className="muted">{formatGb(c.acceleratorMemoryGb || c.systemRamGb)} total</div></> : <span className="faint">—</span>}</div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}
      {simple && (devices.length > 0 || systems.length > 0) && (
        <p className="small muted mode-hint">Memory bandwidth, usable-memory scales, price per GB and side-by-side scanning are in the <strong>Technical</strong> view. Prices are launch MSRPs or editorial estimates, not current prices.</p>
      )}
    </>
  );
}

/** Consistent 4:3 frame. Shows the product image when a properly sourced one exists, otherwise a class placeholder. */
function HardwareMedia({ src, credit, name, icon }: { src: string | null; credit: string | null; name: string; icon: string }) {
  return (
    <div className="hw-media">
      {src
        ? <img src={src} alt={name} title={credit ? `Image: ${credit}` : undefined} loading="lazy" decoding="async" />
        : <span className="hw-placeholder" aria-hidden="true"><PathIcon name={icon} size={30} /></span>}
    </div>
  );
}

function PriceSpec({ quote, none }: { quote: PriceQuote | null; none: string }) {
  if (!quote) return <div><dt>Price</dt><dd><span className="faint">{none}</span></dd></div>;
  const p = formatPrice(quote);
  return <div><dt>Price</dt><dd title={p.description}><b>{p.value}</b>{p.qualifier}</dd></div>;
}

function Signal({ count }: { count: number }) {
  return <span className={count ? 'hw-signal' : 'hw-signal none'}>{count ? `${count} measurement${count === 1 ? '' : 's'}` : 'No measurements yet'}</span>;
}

function DeviceCard({ d }: { d: catalog.DeviceDTO }) {
  const usable = d.memoryKind === 'dedicated' && d.memoryGb ? d.memoryGb * compat.COMPAT_CONSTANTS.dedicatedUsableFraction : null;
  const maxB = usable != null ? maxParamsAtQ4(usable) : null;
  const icon = d.deviceKind === 'accelerator' ? 'server' : d.deviceKind === 'gpu' ? 'gpu' : 'chip';
  return (
    <li className="hw-card">
      <HardwareMedia src={d.imageUrl} credit={d.imageCredit} name={d.name} icon={icon} />
      <div className="hw-id">
        <h3 className="hw-name"><Link href={`/hardware/${d.slug}`}>{shortName(d.name)}</Link></h3>
        <div className="hw-meta">{d.vendor.name} · {deviceClassLabel(d)}{d.releasedOn ? ` · ${d.releasedOn.slice(0, 4)}` : ''}</div>
        <p className="hw-pitch">{devicePositioning(d, maxB)}</p>
      </div>
      <dl className="hw-specs">
        <div>
          <dt>Memory</dt>
          <dd>{d.memoryKind === 'dedicated' && d.memoryGb ? <><b>{d.memoryGb} GB</b>VRAM</> : d.memoryKind === 'unified' ? <><b>Unified</b>size set per system</> : <><b>System RAM</b>no VRAM</>}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd>{maxB != null ? <><b>{roughParams(maxB)}</b>models at 4-bit</> : <><b>Varies</b>with memory</>}</dd>
        </div>
        <PriceSpec quote={devicePrice(d)} none="No launch price" />
      </dl>
      <div className="hw-foot">
        <Signal count={d.resultCount} />
        <Link className="hw-go" href={`/hardware/${d.slug}`} aria-label={`View ${d.name}`}>View hardware →</Link>
      </div>
    </li>
  );
}

function SystemCard({ c }: { c: catalog.ConfigurationDTO }) {
  const u = systemUsableGb(c);
  const maxB = maxParamsAtQ4(u.gb);
  const icon = c.formFactor === 'laptop' ? 'laptop' : c.formFactor === 'mini_pc' ? 'minipc' : c.formFactor === 'server' ? 'server' : 'desktop';
  const name = c.name.replace(/\s*\(.*\)$/, '');
  return (
    <li className="hw-card">
      <HardwareMedia src={c.imageUrl} credit={c.imageCredit} name={c.name} icon={icon} />
      <div className="hw-id">
        <h3 className="hw-name"><Link href={`/hardware/systems/${c.slug}`}>{name}</Link></h3>
        <div className="hw-meta">{systemClassLabel(c)} · {c.components.map((x) => `${x.count > 1 ? `${x.count}× ` : ''}${shortName(x.name).replace(/\s*\(.*\)$/, '')}`).join(' + ')}</div>
        <p className="hw-pitch">{systemPositioning(u.where, maxB, gpuCount(c))}</p>
      </div>
      <dl className="hw-specs">
        <div>
          <dt>Memory</dt>
          <dd>{c.unifiedMemoryGb ? <><b>{c.unifiedMemoryGb} GB</b>unified</> : c.acceleratorMemoryGb ? <><b>{c.acceleratorMemoryGb} GB</b>VRAM · {c.systemRamGb} GB RAM</> : <><b>{c.systemRamGb} GB</b>RAM, no GPU</>}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd><b>{roughParams(maxB)}</b>{u.where === 'ram' ? 'models at 4-bit, slowly' : 'models at 4-bit'}</dd>
        </div>
        <PriceSpec quote={systemPrice(c)} none="No estimate" />
      </dl>
      <div className="hw-foot">
        <Signal count={c.resultCount} />
        <Link className="hw-go" href={`/run?system=${c.slug}`} aria-label={`What can ${name} run?`}>What can it run? →</Link>
      </div>
    </li>
  );
}
