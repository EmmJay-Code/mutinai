import { catalog, getDb } from '@mutinai/db';
import { compat, COMPUTE_BACKENDS, DEVICE_KINDS, deviceCategory, deviceClassLabel, devicePositioning, formatPrice, HARDWARE_CATEGORIES, HARDWARE_GOALS, hardwareGoal, hardwareMemoryTier, MEMORY_TIERS, systemCategories, systemClassLabel, systemMatchesGoal, systemPositioning, type HardwareCategory, type PriceQuote } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PathIcon } from '@/components/icons';
import { EdSection, Group, JumpLinks, Masthead, Meter, StartStrip } from '@/components/editorial';
import { InfoModeToggle } from '@/components/info-mode';
import { Empty } from '@/components/ui';
import { EstimateTag, LinearBar, MemoryScale, ParamsReach } from '@/components/viz';
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

  // Simple view: devices and complete systems together, grouped by the same memory tiers as the models page.
  type Item = { key: string; system: boolean; usable: number | null; node: React.ReactNode };
  const items: Item[] = [
    ...devices.map((d) => {
      const usable = d.memoryKind === 'dedicated' && d.memoryGb ? d.memoryGb * compat.COMPAT_CONSTANTS.dedicatedUsableFraction : null;
      return { key: `d-${d.slug}`, system: false, usable, node: <DeviceRow d={d} usable={usable} /> };
    }),
    ...systems.map((c) => ({ key: `s-${c.slug}`, system: true, usable: systemUsableGb(c).gb, node: <SystemRow c={c} /> })),
  ];
  const tierGroups = [
    { id: 'runs-small', tier: null, level: 0, items: items.filter((i) => i.usable != null && !hardwareMemoryTier(i.usable)) },
    ...MEMORY_TIERS.map((t, n) => ({ id: `runs-${t.key}`, tier: t, level: n + 1, items: items.filter((i) => i.usable != null && hardwareMemoryTier(i.usable)?.key === t.key) })),
    { id: 'sized-per-system', tier: null, level: -1, items: items.filter((i) => i.usable == null) },
  ].filter((g) => g.items.length > 0).map((g) => ({ ...g, items: [...g.items].sort((a, b) => (a.usable ?? 0) - (b.usable ?? 0)) }));
  const tierTitle = (g: (typeof tierGroups)[number]) => g.tier?.label ?? (g.level === 0 ? 'Small models only' : 'Sized per machine');
  const tierHint = (g: (typeof tierGroups)[number]) =>
    g.tier ? (Number.isFinite(g.tier.maxGb) ? <>Runs every model that needs up to <b>{g.tier.maxGb} GB</b>.</> : <>Runs models that need <b>more than 92 GB</b>.</>)
      : g.level === 0 ? 'Holds only the smallest models, below the laptop group.'
        : 'Unified-memory chips and CPUs: what fits depends on how much memory the machine is bought with. The systems built on them are in the groups above.';

  return (
    <>
      <Masthead
        eyebrow={`Hardware · ${everyDevice.length} devices · ${allSystems.length} reference systems`}
        title="Buy for the models you want to run."
        lede="Memory decides which models fit, so hardware is grouped the same way as the models page: a machine in a group runs every model in that group."
      >
        {exploring && <StartStrip items={HARDWARE_GOALS.map((g) => ({ href: `/hardware?goal=${g.key}#catalog`, name: g.label, why: g.hint }))} />}
      </Masthead>

      <EdSection
        id="catalog"
        title={<>{goal ? <><PathIcon name={goal.key} /> {heading}</> : exploring && simple ? 'Every machine, by what it can run' : heading}<span className="count" aria-live="polite">{[devices.length ? `${devices.length} device${devices.length === 1 ? '' : 's'}` : null, systems.length ? `${systems.length} system${systems.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'none'}</span></>}
        intro={goal
          ? <>{goal.explain} <Link className="link" href="/hardware#catalog">Show all hardware</Link></>
          : simple ? 'Usable memory for a model: graphics cards keep about 95% of their memory for it, unified-memory Macs about 75%.' : undefined}
        tools={<>{simple && tierGroups.length > 0 && <JumpLinks items={tierGroups.map((g) => ({ id: g.id, label: g.tier?.short ?? (g.level === 0 ? 'Small' : 'Per machine') }))} />}<InfoModeToggle mode={mode} returnTo={returnTo} /></>}
      >
      <div className="catalog-bar">
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
        <form className="bar-search" action="/hardware#catalog" role="search">
          {Object.entries(current).filter(([k]) => k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="sr-only" htmlFor="hw-q">Search hardware</label>
          <input id="hw-q" type="search" name="q" defaultValue={filters.q} placeholder="RTX, M4, Ryzen…" />
        </form>
        {!simple && devices.length > 0 && (
          <form action="/hardware#catalog" className="tags">
            {Object.entries(current).filter(([k]) => k !== 'sort').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label className="sr-only" htmlFor="hw-sort">Sort devices</label>
            <select id="hw-sort" name="sort" defaultValue={filters.sort}>
              <option value="bandwidth">Fastest memory</option><option value="memory">Most memory</option><option value="released">Newest</option><option value="name">Name</option>
            </select>
            <button className="btn btn-small" type="submit">Sort</button>
          </form>
        )}
      </div>

      {devices.length === 0 && systems.length === 0 && <Empty>No hardware matches. <Link className="link" href="/hardware#catalog">Clear filters</Link>.</Empty>}

      {simple && tierGroups.map((g) => (
        <Group
          key={g.id}
          id={g.id}
          top={g.tier ? <Meter level={g.level} of={MEMORY_TIERS.length} /> : undefined}
          title={tierTitle(g)}
          range={g.tier?.range}
          hint={tierHint(g)}
        >
          <div className="rows-head rows-hardware" aria-hidden="true"><span>Machine</span><span className="r">Memory</span><span className="r">Runs at 4-bit</span><span className="r">Price</span></div>
          <ul className="rows">{g.items.map((i) => <li key={i.key} className="rows-hardware">{i.node}</li>)}</ul>
        </Group>
      ))}

      {!simple && devices.length > 0 && (
        <section aria-labelledby="devices-h">
          {systems.length > 0 && <h3 className="list-title" id="devices-h">{cat === 'server' ? 'Accelerators' : cat === 'unified' ? 'Chips' : 'Devices'} <span className="num">{devices.length}</span></h3>}
          {(
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

      {!simple && systems.length > 0 && (
        <section aria-labelledby="systems-h">
          {devices.length > 0 && <h3 className="list-title" id="systems-h">{cat === 'server' ? 'Servers & multi-GPU builds' : cat === 'unified' ? 'Systems built on them' : 'Reference systems'} <span className="num">{systems.length}</span></h3>}
          {(
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
      </EdSection>
    </>
  );
}

function PriceCell({ quote, none }: { quote: PriceQuote | null; none: string }) {
  if (!quote) return <span className="val r faint">{none}</span>;
  const p = formatPrice(quote);
  return <span className="val r" title={p.description}>{p.value}<small>{p.qualifier}</small></span>;
}

const measurements = (n: number) => (n ? ` · ${n} measurement${n === 1 ? '' : 's'}` : '');

function DeviceRow({ d, usable }: { d: catalog.DeviceDTO; usable: number | null }) {
  const maxB = usable != null ? maxParamsAtQ4(usable) : null;
  return (
    <>
      <div>
        <div className="name"><Link href={`/hardware/${d.slug}`}>{shortName(d.name)}</Link></div>
        <span className="desc">{devicePositioning(d, maxB)}</span>
        <span className="sub">{d.vendor.name} · {deviceClassLabel(d)}{d.releasedOn ? ` · ${d.releasedOn.slice(0, 4)}` : ''}{measurements(d.resultCount)}</span>
      </div>
      <span className="val r">{d.memoryKind === 'dedicated' && d.memoryGb ? <>{d.memoryGb} GB<small>VRAM</small></> : d.memoryKind === 'unified' ? <>Unified<small>set per machine</small></> : <>RAM<small>no VRAM</small></>}</span>
      <span className="val r">{maxB != null ? <>{roughParams(maxB)} <EstimateTag /><small>parameters</small></> : <>Varies<small>with memory</small></>}</span>
      <PriceCell quote={devicePrice(d)} none="No launch price" />
    </>
  );
}

function SystemRow({ c }: { c: catalog.ConfigurationDTO }) {
  const u = systemUsableGb(c);
  const maxB = maxParamsAtQ4(u.gb);
  const name = c.name.replace(/\s*\(.*\)$/, '');
  return (
    <>
      <div>
        <div className="name"><Link href={`/hardware/systems/${c.slug}`}>{name}</Link><span className="system-tag">System</span></div>
        <span className="desc">{systemPositioning(u.where, maxB, gpuCount(c))}</span>
        <span className="sub">{systemClassLabel(c)} · {c.components.map((x) => `${x.count > 1 ? `${x.count}× ` : ''}${shortName(x.name).replace(/\s*\(.*\)$/, '')}`).join(' + ')}{measurements(c.resultCount)} · <Link className="link lift" href={`/run?system=${c.slug}`}>What can it run?</Link></span>
      </div>
      <span className="val r">{c.unifiedMemoryGb ? <>{c.unifiedMemoryGb} GB<small>unified</small></> : c.acceleratorMemoryGb ? <>{c.acceleratorMemoryGb} GB<small>VRAM</small></> : <>{c.systemRamGb} GB<small>RAM, no GPU</small></>}</span>
      <span className="val r">{roughParams(maxB)} <EstimateTag /><small>{u.where === 'ram' ? 'slowly, on CPU' : 'parameters'}</small></span>
      <PriceCell quote={systemPrice(c)} none="No estimate" />
    </>
  );
}
