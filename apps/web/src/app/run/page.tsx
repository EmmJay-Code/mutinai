import { community, compatQueries, getDb } from '@mutinai/db';
import { CAPABILITIES } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, FitBadge, PageHead, Speed, Tag } from '@/components/ui';
import { formatBytes, formatContext, formatParams, humanize, numberParam, searchParam } from '@/lib/format';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'What can I run?' };

type SP = Promise<Record<string, string | string[] | undefined>>;
type Rec = compatQueries.CompatRecommendation;

const CONTEXTS = [2048, 4096, 8192, 16384, 32768, 65536, 131072];

function MemoryBar({ rec }: { rec: Rec }) {
  const m = rec.result.memory;
  const capacity = rec.result.placement === 'cpu' ? m.systemUsableGb : m.acceleratorUsableGb;
  const scale = Math.max(m.totalGb, capacity) || 1;
  const pct = (v: number) => `${(v / scale) * 100}%`;
  return (
    <div>
      <div className="mem-bar" role="img" aria-label={`Needs ${m.totalGb.toFixed(1)} GiB of ${capacity.toFixed(1)} GiB usable`}>
        <i className="w" style={{ width: pct(m.weightsGb) }} />
        <i className="kv" style={{ width: pct(m.kvCacheGb) }} />
        <i className="o" style={{ width: pct(m.overheadGb) }} />
        <i className="cap" style={{ left: `calc(${pct(capacity)} - 2px)` }} />
      </div>
      <div className="small muted num" style={{ marginTop: 2 }}>
        {m.totalGb.toFixed(1)} / {capacity.toFixed(1)} GiB
        {m.offloadedGb > 0 && <> · {m.offloadedGb.toFixed(1)} GiB in RAM</>}
      </div>
    </div>
  );
}

function RecCells({ rec }: { rec: Rec }) {
  return (
    <>
      <td>
        <Link className="primary" href={`/models/${rec.row.modelSlug}#${rec.row.artifactSlug}`}>{rec.row.schemeName}</Link>
        <span className="sub">{rec.row.publisherName} · {formatBytes(rec.row.sizeBytes)}</span>
      </td>
      <td><Link href={`/tools/${rec.runtime.slug}`}>{rec.runtime.name}</Link>{rec.result.placement === 'cpu' && <span className="sub">CPU</span>}</td>
      <td><FitBadge fit={rec.result.fit} /></td>
      <td style={{ minWidth: 160 }}><MemoryBar rec={rec} /></td>
      <td><Speed speed={rec.result.speed} /></td>
    </>
  );
}

export default async function RunPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const db = getDb();
  const viewer = await getViewer();
  const [picker, ownConfigs] = await Promise.all([compatQueries.listHardwarePickerOptions(db), community.listOwnHardwareConfigs(db, viewer)]);

  const mode = searchParam(sp, 'mode') ?? (searchParam(sp, 'mine') ? 'mine' : searchParam(sp, 'd0') ? 'custom' : 'system');
  const ctx = numberParam(sp, 'ctx') ?? 8192;
  const capability = searchParam(sp, 'cap');
  const runtime = searchParam(sp, 'runtime');
  const commercialOnly = searchParam(sp, 'commercial') === '1';
  const systemSlug = searchParam(sp, 'system') ?? 'rtx-4090-workstation';

  let hardware: compatQueries.HardwareSelection | null = null;
  if (mode === 'mine' && searchParam(sp, 'mine')) hardware = await compatQueries.loadUserHardware(db, viewer, searchParam(sp, 'mine')!);
  else if (mode === 'custom') {
    hardware = await compatQueries.buildCustomHardware(db, {
      components: [0, 1].flatMap((i) => (searchParam(sp, `d${i}`) ? [{ deviceSlug: searchParam(sp, `d${i}`)!, count: numberParam(sp, `c${i}`) ?? 1 }] : [])),
      systemRamGb: numberParam(sp, 'ram') ?? 32,
      unifiedMemoryGb: numberParam(sp, 'unified'),
    });
  } else hardware = await compatQueries.loadReferenceHardware(db, systemSlug);

  const results = hardware
    ? await compatQueries.runCompatibility(db, hardware, { contextLength: ctx, capability, runtimeSlugs: runtime ? [runtime] : undefined, commercialOnly })
    : [];

  const tiers = [
    { key: 'accel', title: 'Runs in accelerator memory', rows: results.filter((r) => r.recommended && r.recommended.result.placement === 'accelerator') },
    { key: 'cpu', title: 'Runs on CPU and system RAM', rows: results.filter((r) => r.recommended?.result.placement === 'cpu') },
    { key: 'offload', title: 'Runs with partial offload to system RAM (slower)', rows: results.filter((r) => r.recommended?.result.placement === 'hybrid') },
  ];
  const wontRun = results.filter((r) => !r.recommended);

  return (
    <>
      <PageHead
        eyebrow="Compatibility"
        title="What can I run?"
        lede="Pick a system or describe your own. For each model variant we recommend the highest-precision quantization and runtime that fits, with memory needed and generation speed — measured where the community or a source has measured it, estimated otherwise."
      />

      <form className="filters" action="/run" style={{ alignItems: 'stretch' }}>
        <fieldset style={{ margin: 0, flex: '1 1 420px' }}>
          <legend>Hardware</legend>
          <div className="form-stack">
            <label className="field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <input type="radio" name="mode" value="system" defaultChecked={mode === 'system'} />
              <select name="system" defaultValue={systemSlug} aria-label="Reference system">
                {picker.configurations.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </label>
            {ownConfigs.length > 0 && (
              <label className="field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <input type="radio" name="mode" value="mine" defaultChecked={mode === 'mine'} />
                <select name="mine" defaultValue={searchParam(sp, 'mine')} aria-label="My saved system">
                  {ownConfigs.map((c) => <option key={c.id} value={c.id}>My system: {c.name}</option>)}
                </select>
              </label>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input type="radio" name="mode" value="custom" defaultChecked={mode === 'custom'} aria-label="Custom build" />
              {[0, 1].map((i) => (
                <span key={i} style={{ display: 'inline-flex', gap: 4 }}>
                  <input type="number" name={`c${i}`} min="1" max="8" defaultValue={numberParam(sp, `c${i}`) ?? 1} style={{ width: 52 }} aria-label={`Count for device ${i + 1}`} />
                  <select name={`d${i}`} defaultValue={searchParam(sp, `d${i}`) ?? ''} aria-label={`Device ${i + 1}`}>
                    <option value="">{i === 0 ? 'Device…' : '+ device (optional)'}</option>
                    {picker.devices.map((d) => <option key={d.slug} value={d.slug}>{d.name}{d.memoryGb ? ` (${d.memoryGb} GB)` : ''}</option>)}
                  </select>
                </span>
              ))}
              <input type="number" name="ram" min="0" defaultValue={numberParam(sp, 'ram') ?? 32} style={{ width: 70 }} aria-label="System RAM in GB" />
              <span className="small muted">GB RAM</span>
              <input type="number" name="unified" min="0" defaultValue={numberParam(sp, 'unified')} placeholder="—" style={{ width: 70 }} aria-label="Unified memory in GB" />
              <span className="small muted">GB unified</span>
            </div>
          </div>
        </fieldset>
        <label className="field">
          <span>Context</span>
          <select name="ctx" defaultValue={String(ctx)}>
            {CONTEXTS.map((c) => <option key={c} value={c}>{formatContext(c)} tokens</option>)}
          </select>
        </label>
        <label className="field">
          <span>Use</span>
          <select name="cap" defaultValue={capability ?? ''}>
            <option value="">Any</option>
            {CAPABILITIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Runtime</span>
          <select name="runtime" defaultValue={runtime ?? ''}>
            <option value="">Any</option>
            {picker.runtimes.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
          </select>
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" name="commercial" value="1" defaultChecked={commercialOnly} />
          <span style={{ textTransform: 'none', letterSpacing: 0 }}>Permissive licenses only</span>
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="btn btn-primary" type="submit">Check compatibility</button>
        </div>
      </form>

      {!hardware ? (
        <Empty>Choose a system, or at least one device for a custom build.</Empty>
      ) : (
        <>
          <div className="section-head" style={{ marginTop: 8 }}>
            <h2>
              {hardware.label} <span className="muted small">· {formatContext(ctx)} context</span>
            </h2>
            <div className="legend" aria-hidden="true">
              <span><i style={{ background: 'var(--ink-2)' }} />weights</span>
              <span><i style={{ background: 'var(--community)' }} />KV cache</span>
              <span><i style={{ background: 'var(--faint)' }} />overhead</span>
              <span><i style={{ background: 'var(--ink)', width: 2 }} />usable memory</span>
            </div>
          </div>
          {hardware.source === 'reference' && hardware.slug && (
            <p className="small muted">Measured speeds come from reference results and verified community runs on <Link href={`/hardware/systems/${hardware.slug}`}>this exact system</Link>.</p>
          )}
          {hardware.source !== 'reference' && <p className="small muted">Custom and personal systems use estimates unless verified runs exist for the same configuration.</p>}

          {tiers.map((tier) =>
            tier.rows.length === 0 ? null : (
              <section key={tier.key} className="section" aria-labelledby={`tier-${tier.key}`}>
                <div className="section-head"><h2 id={`tier-${tier.key}`}>{tier.title} <span className="muted num">{tier.rows.length}</span></h2></div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Model variant</th><th className="r">Params</th><th>Recommended quant</th><th>Runtime</th><th>Fit</th><th>Memory</th><th>Generation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tier.rows.map((r) => (
                        <tr key={r.variantSlug}>
                          <td>
                            <Link className="primary" href={`/models/${r.modelSlug}#${r.variantSlug}`}>{r.variantName}</Link>
                            <span className="sub">{r.developerName} · {humanize(r.variantKind)}{r.commercialUse && r.commercialUse !== 'allowed' ? ` · license ${r.commercialUse}` : ''}</span>
                            {r.alternatives.length > 0 && (
                              <details className="alts">
                                <summary>{r.alternatives.length} other option{r.alternatives.length === 1 ? '' : 's'}</summary>
                                <table className="data">
                                  <tbody>
                                    {r.alternatives.slice(0, 6).map((a) => (
                                      <tr key={`${a.row.artifactId}:${a.runtime.id}`}>
                                        <td className="small">{a.row.schemeName} <span className="faint">· {a.row.publisherName}</span></td>
                                        <td className="small">{a.runtime.name}</td>
                                        <td><FitBadge fit={a.result.fit} /></td>
                                        <td className="small num">{a.result.memory.totalGb.toFixed(1)} GiB</td>
                                        <td className="small"><Speed speed={a.result.speed} /></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </details>
                            )}
                          </td>
                          <td className="r num">{formatParams(r.paramsTotal)}{r.paramsActive && <span className="sub">{formatParams(r.paramsActive)} active</span>}</td>
                          <RecCells rec={r.recommended!} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ),
          )}

          {results.length === 0 && <Empty>No variants match these filters.</Empty>}

          {wontRun.length > 0 && (
            <section className="section">
              <details>
                <summary><strong>Won’t run on this hardware</strong> <span className="muted num">{wontRun.length}</span></summary>
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="data">
                    <thead><tr><th>Model variant</th><th className="r">Params</th><th>Why</th></tr></thead>
                    <tbody>
                      {wontRun.map((r) => (
                        <tr key={r.variantSlug}>
                          <td><Link href={`/models/${r.modelSlug}#${r.variantSlug}`}>{r.variantName}</Link></td>
                          <td className="r num">{formatParams(r.paramsTotal)}</td>
                          <td className="small muted">{r.artifactsConsidered} artifact{r.artifactsConsidered === 1 ? '' : 's'} checked; smallest needs more memory than available{runtime ? ' with this runtime' : ''}.</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          )}

          <section className="section panel panel-pad small">
            <h3 style={{ marginBottom: 6 }}>How this is calculated</h3>
            <p className="muted">
              Memory = quantized file size + fp16 KV cache for the chosen context + runtime overhead. Usable memory is 95% of dedicated VRAM, a
              device-specific share of unified memory (75% by default), and 80% of system RAM for runtimes that can offload. Runtimes must load the
              artifact’s format and support a backend present on the hardware. Estimated generation speed is bounded by memory bandwidth ÷ bytes read per
              token (active parameters for MoE), shown with <Tag>est.</Tag> and a ±35% range. Measured speeds are medians of reference results and
              verified public community runs on the same system, artifact and runtime.
            </p>
          </section>
        </>
      )}
    </>
  );
}
