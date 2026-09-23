import { catalog, community, compatQueries, getDb } from '@mutinai/db';
import { balanceStarterDownload, CAPABILITIES, describeModel, pickStarter, profileMean, readingSpeed, speedupPhrase, STARTER_MIN_TPS } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Disclosure, Empty, FitBadge, LicenseShort, Speed, PageHead } from '@/components/ui';
import { RunSteps } from '@/components/run-steps';
import { EntityMark, EstimateTag, MemoryScale, ParamsReach } from '@/components/viz';
import { maxParamsAtQ4, systemUsableGb } from '@/lib/hardware';
import { measurementPolicy } from '@/lib/community-visibility';
import { CAPABILITY_LABEL, FORM_FACTOR_LABEL, formatBytes, formatContext, formatParams, humanize, numberParam, searchParam } from '@/lib/format';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'What can I run?' };

type SP = Promise<Record<string, string | string[] | undefined>>;
type Rec = compatQueries.CompatRecommendation;

const CONTEXTS: [number, string][] = [
  [4096, 'Short chats (4K tokens)'],
  [8192, 'Everyday use (8K)'],
  [16384, 'Longer documents (16K)'],
  [32768, 'Long documents (32K)'],
  [65536, 'Very long (64K)'],
  [131072, 'Maximum (128K)'],
];

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
      <div className="small muted num" style={{ marginTop: 4 }}>
        {m.totalGb.toFixed(1)} of {capacity.toFixed(1)} GiB
        {m.offloadedGb > 0 && <> · {m.offloadedGb.toFixed(1)} in RAM</>} <EstimateTag />
      </div>
    </div>
  );
}

export default async function RunPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const db = getDb();
  const viewer = await getViewer();
  const [picker, ownConfigs, configurations, profiles] = await Promise.all([compatQueries.listHardwarePickerOptions(db), community.listOwnHardwareConfigs(db, viewer), catalog.listConfigurations(db), catalog.listCapabilityProfiles(db)]);

  const explicitMode = searchParam(sp, 'mode');
  const mode = explicitMode ?? (searchParam(sp, 'mine') ? 'mine' : searchParam(sp, 'd0') ? 'custom' : searchParam(sp, 'system') ? 'system' : null);
  const ctx = numberParam(sp, 'ctx') ?? 8192;
  const capability = searchParam(sp, 'cap');
  const runtime = searchParam(sp, 'runtime');
  const commercialOnly = searchParam(sp, 'commercial') === '1';
  const systemSlug = searchParam(sp, 'system');

  let hardware: compatQueries.HardwareSelection | null = null;
  if (mode === 'mine' && searchParam(sp, 'mine')) hardware = await compatQueries.loadUserHardware(db, viewer, searchParam(sp, 'mine')!);
  else if (mode === 'custom' && searchParam(sp, 'd0')) {
    hardware = await compatQueries.buildCustomHardware(db, {
      components: [0, 1].flatMap((i) => (searchParam(sp, `d${i}`) ? [{ deviceSlug: searchParam(sp, `d${i}`)!, count: numberParam(sp, `c${i}`) ?? 1 }] : [])),
      systemRamGb: numberParam(sp, 'ram') ?? 32,
      unifiedMemoryGb: numberParam(sp, 'unified'),
    });
  } else if (mode === 'system' && systemSlug) hardware = await compatQueries.loadReferenceHardware(db, systemSlug);

  const results = hardware
    ? await compatQueries.runCompatibility(db, hardware, { contextLength: ctx, capability, runtimeSlugs: runtime ? [runtime] : undefined, commercialOnly, ...measurementPolicy() })
    : [];

  const accel = results.filter((r) => r.recommended?.result.placement === 'accelerator');
  const cpu = results.filter((r) => r.recommended?.result.placement === 'cpu');
  const offload = results.filter((r) => r.recommended?.result.placement === 'hybrid');
  const wontRun = results.filter((r) => !r.recommended);
  // One suggestion to start with, so the first thing a newcomer sees is a model rather than a table. Its download is
  // balanced for speed (a first model should type quickly); the tables below keep the highest-precision recommendation.
  const tpsOf = (rec: Rec) => (rec.result.speed.basis === 'unknown' ? null : rec.result.speed.genTps);
  const asOption = (rec: Rec) => ({ rec, bitsPerWeight: rec.row.bitsPerWeight, fit: rec.result.fit, placement: rec.result.placement, genTps: tpsOf(rec), measured: rec.result.speed.basis === 'measured' });
  const starter = pickStarter(results.flatMap((r) => {
    if (!r.recommended) return [];
    const { pick, swappedFrom } = balanceStarterDownload(asOption(r.recommended), r.alternatives.map(asOption));
    return [{ ...r, download: pick.rec, swappedFrom: swappedFrom?.rec ?? null, placement: pick.placement, fit: pick.fit, genTps: pick.genTps, quality: profileMean(profiles[r.modelSlug]) }];
  }));
  const unifiedFraction = hardware?.spec.components.find((c) => c.device.memoryKind === 'unified')?.device.unifiedUsableFraction ?? 0.75;
  const tiers = [
    { key: 'accel', title: 'Runs in accelerator memory', intro: 'Fits entirely in GPU or unified memory — the fast path.', rows: accel },
    { key: 'cpu', title: 'Runs on CPU and system RAM', intro: 'Works without a GPU. Expect slower generation.', rows: cpu },
    { key: 'offload', title: 'Runs with partial offload to system RAM', intro: 'Too big for accelerator memory alone; part of it runs from system RAM, which is much slower.', rows: offload },
  ];

  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (ctx !== 8192) p.set('ctx', String(ctx));
    if (capability) p.set('cap', capability);
    if (runtime) p.set('runtime', runtime);
    if (commercialOnly) p.set('commercial', '1');
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/run?${p}`;
  };
  const selectionParams: Record<string, string> =
    mode === 'mine' ? { mode: 'mine', mine: searchParam(sp, 'mine') ?? '' }
      : mode === 'custom' ? Object.fromEntries(['d0', 'c0', 'd1', 'c1', 'ram', 'unified'].flatMap((k) => (searchParam(sp, k) ? [[k, searchParam(sp, k)!]] : [])).concat([['mode', 'custom']]))
        : mode === 'system' && systemSlug ? { mode: 'system', system: systemSlug } : {};

  const systemsByForm = Object.entries(
    picker.configurations.reduce<Record<string, typeof picker.configurations>>((acc, c) => ({ ...acc, [c.formFactor]: [...(acc[c.formFactor] ?? []), c] }), {}),
  ).sort(([a], [b]) => ['laptop', 'mini_pc', 'desktop', 'server'].indexOf(a) - ['laptop', 'mini_pc', 'desktop', 'server'].indexOf(b));

  const has = (slug: string) => picker.configurations.some((c) => c.slug === slug);
  const quick = [
    { slug: 'macbook-air-m1-8gb', label: 'Mac with 8 GB' },
    { slug: 'macbook-air-m4-16gb', label: 'Mac with 16 GB' },
    { slug: 'windows-laptop-16gb', label: 'Windows laptop, 16 GB, no graphics card' },
    { slug: 'rtx-4060-ti-16gb-budget', label: 'PC with a 16 GB graphics card' },
  ].filter((q) => has(q.slug));
  const picker_ = (
    <div className="system-picker">
      {quick.length > 0 && (
        <Disclosure id="not-sure" title="Not sure what you have? Help me check" meta="Two numbers decide it: memory, and whether there is a graphics card" open={!hardware && mode !== 'custom'}>
          <div className="check-help">
            <div>
              <h4>On a Mac</h4>
              <p>Click the Apple logo in the top-left corner of the screen, then <strong>About This Mac</strong>. Note the <strong>Chip</strong> (M1, M2, M3, M4…) and the <strong>Memory</strong> (8 GB, 16 GB…).</p>
            </div>
            <div>
              <h4>On Windows</h4>
              <p>Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Esc</kbd> to open Task Manager, then <strong>Performance</strong>. <strong>Memory</strong> shows your RAM. If a <strong>GPU</strong> entry lists <strong>Dedicated GPU memory</strong> of 4 GB or more, you have a graphics card; otherwise you don’t.</p>
            </div>
          </div>
          <p className="small muted" style={{ margin: '10px 0 6px' }}>Then pick the closest match — or the Build your own setup option below for anything else:</p>
          <div className="chips">
            {quick.map((q) => <Link key={q.slug} className="chip" href={keep({ mode: 'system', system: q.slug })}>{q.label}</Link>)}
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>Still unsure? Start with <Link className="link" href={keep({ mode: 'system', system: 'windows-laptop-16gb' })}>the 16 GB laptop</Link>: what runs there runs on almost any recent computer.</p>
        </Disclosure>
      )}
      {ownConfigs.length > 0 && (
        <div className="picker-group">
          <h4>My systems</h4>
          <div className="chips">
            {ownConfigs.map((c) => <Link key={c.id} className="chip" aria-current={mode === 'mine' && searchParam(sp, 'mine') === c.id} href={keep({ mode: 'mine', mine: c.id })}>{c.name}</Link>)}
          </div>
        </div>
      )}
      {systemsByForm.map(([form, systems]) => (
        <div className="picker-group" key={form}>
          <h4>{FORM_FACTOR_LABEL[form] ?? humanize(form)}</h4>
          <div className="chips">
            {systems.map((s) => <Link key={s.slug} className="chip" aria-current={mode === 'system' && systemSlug === s.slug} href={keep({ mode: 'system', system: s.slug })}>{s.name.replace(/\s*\(.*\)$/, '')}</Link>)}
          </div>
        </div>
      ))}
      <Disclosure id="custom" title="Build your own setup" meta="Choose GPUs or a chip and how much memory you have" open={mode === 'custom' && !hardware}>
        <form action="/run" className="form-grid" style={{ alignItems: 'end' }}>
          <input type="hidden" name="mode" value="custom" />
          {[0, 1].map((i) => (
            <div key={i} style={{ display: 'contents' }}>
              <label className="field">
                <span>{i === 0 ? 'Main device' : 'Second device (optional)'}</span>
                <select name={`d${i}`} defaultValue={searchParam(sp, `d${i}`) ?? ''} required={i === 0}>
                  <option value="">{i === 0 ? 'Choose…' : 'None'}</option>
                  {picker.devices.map((d) => <option key={d.slug} value={d.slug}>{d.name}{d.memoryGb ? ` (${d.memoryGb} GB)` : ''}</option>)}
                </select>
              </label>
              <label className="field">
                <span>How many</span>
                <input type="number" name={`c${i}`} min="1" max="8" defaultValue={numberParam(sp, `c${i}`) ?? 1} />
              </label>
            </div>
          ))}
          <label className="field"><span>System RAM (GB)</span><input type="number" name="ram" min="0" defaultValue={numberParam(sp, 'ram') ?? 32} /></label>
          <label className="field"><span>Unified memory (GB, Mac/APU)</span><input type="number" name="unified" min="0" defaultValue={numberParam(sp, 'unified')} placeholder="—" /></label>
          {ctx !== 8192 && <input type="hidden" name="ctx" value={ctx} />}
          <div><button className="btn btn-primary" type="submit">Check this setup</button></div>
        </form>
      </Disclosure>
    </div>
  );

  return (
    <>
      <PageHead
        eyebrow={hardware ? `What can I run? · ${formatContext(ctx)} context` : 'What can I run?'}
        title={hardware ? hardware.label : 'Start from the machine you have.'}
        lede={hardware ? undefined : 'Pick the closest setup. Mutinai recommends a download and a runtime for each model, and shows the memory it needs and how fast it will answer.'}
      />

      {!hardware ? (
        <>
          <div className="step" style={{ marginTop: 4 }}>Choose hardware</div>
          {mode === 'mine' && <div className="alert alert-error" role="alert">That system isn’t available.</div>}
          {picker_}
          <section className="section" aria-labelledby="systems-glance">
            <div className="section-head"><h2 id="systems-glance"><span className="glyph g-system" aria-hidden="true" /> Reference systems at a glance</h2><p>Usable memory and the largest dense model each holds at 4-bit.</p></div>
            <ul className="list-plain" style={{ columns: 2, columnGap: 32 }}>
              {[...configurations].sort((a, b) => systemUsableGb(b).gb - systemUsableGb(a).gb).map((c) => {
                const u = systemUsableGb(c);
                return (
                  <li key={c.slug} style={{ breakInside: 'avoid', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 130px 130px', gap: 14, alignItems: 'center' }}>
                    <Link href={keep({ mode: 'system', system: c.slug })} style={{ fontWeight: 600 }}>{c.name.replace(/\s*\(.*\)$/, '')}<span className="small muted" style={{ display: 'block', fontWeight: 400 }}>{humanize(c.formFactor)}</span></Link>
                    <MemoryScale gb={u.gb} label={u.where === 'ram' ? 'RAM' : u.where === 'unified' ? 'unified' : 'GPU'} />
                    <ParamsReach maxB={maxParamsAtQ4(u.gb)} label="holds" />
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      ) : (
        <>
          <Disclosure title="Change hardware" meta={`Currently: ${hardware.label}`}>{picker_}</Disclosure>

          <form action="/run" className="filters" style={{ marginTop: 12 }}>
            {Object.entries(selectionParams).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label className="field">
              <span>How much text</span>
              <select name="ctx" defaultValue={String(ctx)}>
                {CONTEXTS.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Use case</span>
              <select name="cap" defaultValue={capability ?? ''}>
                <option value="">Anything</option>
                {CAPABILITIES.map((c) => <option key={c} value={c}>{CAPABILITY_LABEL[c] ?? humanize(c)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Software</span>
              <select name="runtime" defaultValue={runtime ?? ''}>
                <option value="">Any runtime</option>
                {picker.runtimes.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
              </select>
            </label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 }}>
              <input type="checkbox" name="commercial" value="1" defaultChecked={commercialOnly} /> <span style={{ color: 'var(--ink-2)' }}>Permissive licenses only</span>
            </label>
            <button className="btn" type="submit">Update</button>
          </form>

          <div className="run-summary" aria-live="polite">
            <div><span className="fit fit-full" /><b>{accel.length + cpu.length}</b><span>run well</span></div>
            <div><span className="fit fit-offload" /><b>{offload.length}</b><span>with offload</span></div>
            <div><span className="fit fit-none" /><b>{wontRun.length}</b><span>too large</span></div>
            <div style={{ flex: '1 1 260px', minWidth: 200 }}><MemoryScale gb={hardware.spec.unifiedMemoryGb ? hardware.spec.unifiedMemoryGb * unifiedFraction : hardware.spec.components.reduce((a, c) => a + (c.device.memoryKind === 'dedicated' ? (c.device.memoryGb ?? 0) * c.count * 0.95 : 0), 0) || hardware.spec.systemRamGb * 0.8} label="Usable memory" /></div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {hardware.source === 'reference' && hardware.slug
              ? <>Speeds marked measured come from reference results and verified community runs on <Link href={`/hardware/systems/${hardware.slug}`}>this exact system</Link>; others are estimates.</>
              : 'Custom and personal systems use estimates unless verified runs exist for the same configuration.'}
          </p>

          {starter && (() => {
            const rec = starter.download;
            const tps = tpsOf(rec);
            const from = starter.swappedFrom;
            const fromTps = from ? tpsOf(from) : null;
            const estimated = rec.result.speed.basis === 'estimated' || from?.result.speed.basis === 'estimated';
            const pace = readingSpeed(tps);
            const d = describeModel(starter, profiles[starter.modelSlug]);
            const capacity = rec.result.placement === 'cpu' ? rec.result.memory.systemUsableGb : rec.result.memory.acceleratorUsableGb;
            return (
              <section className="starter" aria-labelledby="starter-h">
                <div className="starter-top">
                  <div>
                    <div className="eyebrow">Start with this one</div>
                    <h2 id="starter-h"><Link href={`/models/${starter.modelSlug}#${starter.variantSlug}`}>{starter.variantName}</Link></h2>
                    <p className="starter-what">{d.summary} From {starter.developerName}.</p>
                  </div>
                  <dl className="starter-facts">
                    <div><dt>Speed</dt><dd>{pace?.text ?? 'Speed not known yet'}{rec.result.speed.basis === 'estimated' && <> <EstimateTag title="Estimated from memory bandwidth, not measured on this machine" /></>}<span className="sub"><Speed speed={rec.result.speed} /></span></dd></div>
                    <div><dt>Download</dt><dd>{formatBytes(rec.row.sizeBytes)}<span className="sub mono">{rec.row.schemeName}</span></dd></div>
                    <div><dt>Memory</dt><dd>{rec.result.memory.totalGb.toFixed(1)} of {capacity.toFixed(1)} GB <EstimateTag /><span className="sub">{rec.result.fit === 'tight' ? 'a tight fit: close other apps first' : rec.result.placement === 'cpu' ? 'runs on the processor' : 'fits entirely'}</span></dd></div>
                    <div><dt>License</dt><dd><LicenseShort commercialUse={starter.commercialUse} /><span className="sub">{starter.licenseName ?? 'not recorded'}</span></dd></div>
                  </dl>
                </div>
                <p className="small starter-why">
                  Why this one: a general chat model that fits this machine without spilling out of memory, {tps != null && tps >= 8 ? 'answers faster than you read, ' : ''}and has the strongest benchmark results among those that do.
                  {from && tps != null && fromTps != null && (
                    <> Picked <span className="mono">{rec.row.schemeName}</span> over <span className="mono">{from.row.schemeName}</span> because it types {speedupPhrase(tps, fromTps)} faster on this machine (~{Math.round(tps)} vs ~{Math.round(fromTps)} tokens a second{estimated ? ', estimated' : ''}); the larger file is a little more accurate but would run under {STARTER_MIN_TPS} tokens a second. It is in the table below if you want it.</>
                  )}
                </p>
                <h3 className="starter-run">Now run it</h3>
                <RunSteps variantName={starter.variantName} recommended={rec} alternatives={[starter.recommended!, ...starter.alternatives].filter((a) => a !== rec)} />
              </section>
            );
          })()}

          {results.some((r) => r.recommended) && <h2 className="run-all-head">Everything that runs here <span className="muted small">grouped by how it runs</span></h2>}
          {tiers.map((tier) => tier.rows.length === 0 ? null : (
            <section key={tier.key} className="section-tight" aria-labelledby={`tier-${tier.key}`}>
              <div className="section-head">
                <div>
                  <h2 id={`tier-${tier.key}`}><span className={`fit fit-${tier.key === 'offload' ? 'offload' : 'full'}`} aria-hidden="true" />{tier.title} <span className="muted num">{tier.rows.length}</span></h2>
                  <p>{tier.intro}</p>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data stack-sm">
                  <thead>
                    <tr><th>Model</th><th>Recommended download</th><th>Memory</th><th>Generation speed</th></tr>
                  </thead>
                  <tbody>
                    {tier.rows.map((r) => {
                      const rec = r.recommended!;
                      return (
                        <tr key={r.variantSlug}>
                          <td data-label="Model">
                            <Link className="primary" href={`/models/${r.modelSlug}#${r.variantSlug}`} style={{ font: '600 15px/1.3 var(--serif)' }}><EntityMark type="variant" /> {r.variantName}</Link>
                            <span className="sub">{r.developerName} · {formatParams(r.paramsTotal)}{r.paramsActive ? ` (${formatParams(r.paramsActive)} active)` : ''}</span>
                            {r.alternatives.length > 0 && (
                              <details className="alts">
                                <summary>{r.alternatives.length} other option{r.alternatives.length === 1 ? '' : 's'}</summary>
                                <table className="data dense">
                                  <tbody>
                                    {r.alternatives.slice(0, 6).map((a) => (
                                      <tr key={`${a.row.artifactId}:${a.runtime.id}`}>
                                        <td>{a.row.schemeName} <span className="faint">· {a.row.publisherName}</span></td>
                                        <td>{a.runtime.name}</td>
                                        <td><FitBadge fit={a.result.fit} /></td>
                                        <td className="num">{a.result.memory.totalGb.toFixed(1)} GiB</td>
                                        <td><Speed speed={a.result.speed} /></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </details>
                            )}
                          </td>
                          <td data-label="Download">
                            <Link className="mono" href={`/models/${r.modelSlug}#${rec.row.artifactSlug}`}>{rec.row.schemeName}</Link> <span className="muted">via</span> <Link href={`/tools/${rec.runtime.slug}`}>{rec.runtime.name}</Link>
                            <span className="sub">{formatBytes(rec.row.sizeBytes)} · {rec.row.publisherName}</span>
                            {rec.result.fit === 'tight' && <span className="sub"><FitBadge fit="tight" /></span>}
                          </td>
                          <td data-label="Memory" style={{ minWidth: 150 }}><MemoryBar rec={rec} /></td>
                          <td data-label="Speed"><Speed speed={rec.result.speed} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          {results.length === 0 && <Empty>No models match these options.</Empty>}

          <div className="section">
            {wontRun.length > 0 && (
              <Disclosure title="Too large for this hardware" meta={`${wontRun.length} model variant${wontRun.length === 1 ? '' : 's'}`}>
                <ul className="list-plain">
                  {wontRun.map((r) => (
                    <li key={r.variantSlug}>
                      <Link href={`/models/${r.modelSlug}#${r.variantSlug}`}>{r.variantName}</Link>{' '}
                      <span className="small muted">{formatParams(r.paramsTotal)} · {r.artifactsConsidered} download{r.artifactsConsidered === 1 ? '' : 's'} checked{runtime ? ' with this runtime' : ''}</span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
            <Disclosure title="How this is calculated" meta="Memory, fit and speed estimates">
              <div className="legend" style={{ marginBottom: 'var(--s3)' }} aria-hidden="true">
                <span><i style={{ background: 'var(--ink-2)' }} />model weights</span>
                <span><i style={{ background: 'var(--e-hardware)' }} />conversation cache</span>
                <span><i style={{ background: 'var(--faint)' }} />overhead</span>
                <span><i style={{ background: 'var(--accent)', width: 2 }} />usable memory</span>
              </div>
              <div className="prose small muted">
                <p>
                  Memory = download size + fp16 KV cache for {formatContext(ctx)} tokens + runtime overhead. Usable memory is 95% of dedicated VRAM, a device-specific share of unified memory (75% by default), and 80% of system RAM for runtimes that can offload. Runtimes must load the file format and support a backend present on the hardware.
                </p>
                <p>
                  Estimated speed is bounded by memory bandwidth ÷ bytes read per token (active parameters for mixture-of-experts), shown in italics with an <strong>estimate</strong> label and a ±35% range (hover for it). Measured speeds are medians of reference results and verified public community runs on the same system, download and runtime. For each model we recommend the highest-precision download that fits, preferring not to offload.
                </p>
              </div>
            </Disclosure>
          </div>
        </>
      )}
    </>
  );
}
