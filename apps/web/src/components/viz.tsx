/**
 * Mutinai visual vocabulary: entity marks and small, data-honest visualisations.
 * Server components (pure SVG/CSS). Every graphic carries a text alternative.
 */
import type { CapabilityProfile } from '@mutinai/domain';
import { CAPABILITY_AXES } from '@mutinai/domain';

export type EntityType = 'model' | 'variant' | 'artifact' | 'hardware' | 'system' | 'tool' | 'bench' | 'event' | 'org' | 'member';

const KIND_TO_ENTITY: Record<string, EntityType> = {
  model: 'model', model_family: 'model', model_release: 'event', model_variant: 'variant', model_artifact: 'artifact', quantization_scheme: 'artifact',
  hardware_device: 'hardware', hardware_configuration: 'system', project: 'tool', benchmark: 'bench', organization: 'org',
  model_release_event: 'event', runtime_release: 'tool', hardware_launch: 'hardware', benchmark_update: 'bench', announcement: 'event',
};

export const ENTITY_WORD: Record<EntityType, string> = {
  model: 'Model', variant: 'Variant', artifact: 'Download', hardware: 'Hardware', system: 'System', tool: 'Tool', bench: 'Benchmark', event: 'Event', org: 'Organization', member: 'Member',
};

export function entityTypeFor(kindOrEvent: string): EntityType {
  return kindOrEvent === 'model_release' ? 'model' : KIND_TO_ENTITY[kindOrEvent] ?? 'event';
}

/** Shape + optional word. Shape distinguishes entity types without relying on colour. */
export function EntityMark({ type, word, label }: { type: EntityType; word?: boolean | string; label?: string }) {
  const text = typeof word === 'string' ? word : ENTITY_WORD[type];
  return (
    <span className="entity" title={label ?? text}>
      <span className={`glyph g-${type}`} aria-hidden="true" />
      {word ? <span className="entity-word">{text}</span> : <span className="sr-only">{text}</span>}
    </span>
  );
}

export function Avatar({ handle, size }: { handle: string; size?: 'lg' }) {
  const hue = [...handle].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className={`avatar${size === 'lg' ? ' lg' : ''}`} style={{ background: `hsl(${hue} 28% 68%)` }} aria-hidden="true">
      {handle.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Sparkline({ values, width = 120, height = 22, label }: { values: number[]; width?: number; height?: number; label: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 3 - ((v - min) / (max - min || 1)) * (height - 6)] as const);
  const last = pts[pts.length - 1]!;
  return (
    <svg className="spark" width={width} height={height} role="img" aria-label={label}>
      <polyline fill="none" stroke="var(--line-strong)" strokeWidth="1.5" strokeLinejoin="round" points={pts.map((p) => p.join(',')).join(' ')} />
      <polyline fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" points={pts.slice(-3).map((p) => p.join(',')).join(' ')} />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill="var(--accent)" />
    </svg>
  );
}

export function ActivityBars({ values, labels, width = 132, height = 22, label }: { values: number[]; labels?: string[]; width?: number; height?: number; label: string }) {
  const max = Math.max(...values, 1);
  const w = width / values.length;
  return (
    <svg className="bars-chart" width={width} height={height + (labels ? 11 : 0)} role="img" aria-label={label}>
      {values.map((v, i) => {
        const h = v ? Math.max(2, (v / max) * height) : 1;
        return <rect key={i} x={i * w + 1} y={height - h} width={Math.max(2, w - 2.5)} height={h} rx="1" fill={i === values.length - 1 ? 'var(--accent)' : 'var(--line-strong)'} />;
      })}
      {labels && [0, values.length - 1].map((i) => (
        <text key={i} x={i === 0 ? 1 : width - 1} y={height + 10} textAnchor={i === 0 ? 'start' : 'end'} style={{ font: '9px var(--mono)', fill: 'var(--faint)' }}>{labels[i]}</text>
      ))}
    </svg>
  );
}

const AXIS_SHORT: Record<string, string> = { coding: 'C', reasoning: 'R', knowledge: 'K', instruction: 'I' };

/** Four-axis capability profile relative to the best open result in the catalog. */
export function CapabilityBars({ profile, legend = false }: { profile: CapabilityProfile | undefined; legend?: boolean }) {
  const text = CAPABILITY_AXES.map((a) => `${a.label}: ${profile?.[a.key] ? `${profile[a.key]!.score}% of best` : 'no data'}`).join('; ');
  return (
    <span style={{ display: 'inline-block' }}>
      <span className="profile" role="img" aria-label={`Capability profile. ${text}`} title={text}>
        {CAPABILITY_AXES.map((a) => {
          const s = profile?.[a.key];
          return s ? <span key={a.key}><i style={{ height: `${Math.max(8, s.score)}%` }} /></span> : <span key={a.key} className="none" />;
        })}
      </span>
      {legend && <span className="profile-legend" aria-hidden="true">{CAPABILITY_AXES.map((a) => <span key={a.key}>{AXIS_SHORT[a.key]}</span>)}</span>}
    </span>
  );
}

export function CapabilityDetail({ profile, benchmarkNames }: { profile: CapabilityProfile | undefined; benchmarkNames: Record<string, string> }) {
  return (
    <div className="profile-md">
      {CAPABILITY_AXES.map((a) => {
        const s = profile?.[a.key];
        return (
          <div className="axis" key={a.key}>
            <span>{a.label}</span>
            <span className="track" role="img" aria-label={s ? `${s.score}% of best open result` : 'No data'}>{s && <i style={{ width: `${s.score}%` }} />}</span>
            <span className="val" title={s ? benchmarkNames[s.benchmark] ?? s.benchmark : undefined}>{s ? `${s.value.toFixed(1)} ${abbrev(benchmarkNames[s.benchmark] ?? s.benchmark)}` : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

const abbrev = (name: string) => (name.length > 9 ? name.split(/[\s-]/)[0]! : name);

const MEM_MIN = 2, MEM_MAX = 8; // log2 GB range: 4–256 GB
export const memPos = (gb: number) => Math.max(0, Math.min(1, (Math.log2(Math.max(gb, 1)) - MEM_MIN) / (MEM_MAX - MEM_MIN)));

/** Memory requirement on a log scale with familiar reference points; optional capacity marker. */
export function MemoryScale({ gb, capacityGb, label = 'Memory', showValue = true, ticks = [8, 24, 96], exact = false }: { gb: number | null; capacityGb?: number; label?: string; showValue?: boolean; ticks?: number[]; exact?: boolean }) {
  if (gb == null) return <span className="faint">—</span>;
  return (
    <div className="memscale" role="img" aria-label={`${label}: about ${Math.ceil(gb)} GB${capacityGb ? ` of ${Math.round(capacityGb)} GB` : ''}`}>
      {showValue && <div className="top"><span className="muted">{label}</span><span className="value">{exact ? `${gb} GB` : `~${Math.ceil(gb)} GB`}</span></div>}
      <div className="track">
        <div className="fill" style={{ width: `${memPos(gb) * 100}%` }} />
        {[8, 16, 24, 48, 96, 192].map((t) => <span key={t} className="tick" style={{ left: `${memPos(t) * 100}%` }} />)}
        {capacityGb && <span className="cap" style={{ left: `${memPos(capacityGb) * 100}%` }} />}
      </div>
      <div className="labels" aria-hidden="true">{ticks.map((t) => <span key={t} style={{ left: `${memPos(t) * 100}%` }}>{t}</span>)}</div>
    </div>
  );
}

/** Reference systems where something runs well (filled), slowly (muted) or not at all (empty). */
export function SystemsMeter({ runsWell, slow = 0, of }: { runsWell: number; slow?: number; of: number }) {
  return (
    <span className="nowrap" title={`Runs well on ${runsWell} of ${of} reference systems${slow ? `, slowly on ${slow}` : ''}`}>
      <span className="segments" role="img" aria-label={`Runs well on ${runsWell} of ${of} reference systems`}>
        {Array.from({ length: of }, (_, i) => <i key={i} className={i < runsWell ? 'ok' : i < runsWell + slow ? 'slow' : ''} />)}
      </span>
      <span className="num">{runsWell}/{of}</span>
    </span>
  );
}

export function Heat({ level, max = 3, label }: { level: number; max?: number; label: string }) {
  return (
    <span className="heat" role="img" aria-label={label} title={label}>
      {Array.from({ length: max }, (_, i) => <i key={i} className={i < level ? 'on' : ''} />)}
    </span>
  );
}

/** Step chart of the best known open result over time. */
export function FrontierChart({ points, width = 312, height = 118, unit = '%' }: { points: { date: string; value: number; name: string }[]; width?: number; height?: number; unit?: string }) {
  if (points.length < 2) return null;
  const t = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime();
  const t0 = t(points[0]!.date), t1 = t(points[points.length - 1]!.date);
  const vmin = Math.floor(Math.min(...points.map((p) => p.value)) / 10) * 10, vmax = Math.ceil(Math.max(...points.map((p) => p.value)) / 10) * 10;
  const pad = { l: 26, r: 8, t: 16, b: 16 };
  const x = (d: string) => pad.l + ((t(d) - t0) / (t1 - t0 || 1)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - vmin) / (vmax - vmin || 1)) * (height - pad.t - pad.b);
  const path = points.map((p, i) => (i === 0 ? `M${x(p.date)},${y(p.value)}` : `H${x(p.date)} V${y(p.value)}`)).join(' ');
  const last = points[points.length - 1]!;
  const fmt = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  return (
    <svg className="frontier" width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Best open result rose from ${points[0]!.value}${unit} to ${last.value}${unit} (${last.name})`}>
      {[vmin, vmax].map((v) => (
        <g key={v}><line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={pad.l - 4} y={y(v) + 3} textAnchor="end">{v}</text></g>
      ))}
      <path d={`${path} H${width - pad.r}`} fill="none" stroke="var(--e-bench)" strokeWidth="2" />
      {points.map((p) => <circle key={p.date + p.name} cx={x(p.date)} cy={y(p.value)} r="3" fill="var(--e-bench)"><title>{`${p.name}: ${p.value}${unit}`}</title></circle>)}
      <text className="label" x={x(last.date) - 6} y={y(last.value) - 6} textAnchor="end">{last.name} · {last.value}</text>
      <text x={pad.l} y={height - 3}>{fmt(points[0]!.date)}</text>
      <text x={width - pad.r} y={height - 3} textAnchor="end">{fmt(last.date)}</text>
    </svg>
  );
}

const paramPos = (b: number) => Math.max(0, Math.min(1, Math.log2(Math.max(b, 1)) / Math.log2(1000)));

/** How large a (dense, 4-bit) model a device or system can hold, on a 1B–1T log scale. */
export function ParamsReach({ maxB, label = 'Runs up to' }: { maxB: number; label?: string }) {
  const rough = maxB < 1 ? 'under 1B' : maxB >= 100 ? `~${Math.round(maxB / 10) * 10}B` : `~${Math.floor(maxB)}B`;
  return (
    <div className="memscale" role="img" aria-label={`${label} about ${rough} parameters at 4-bit`}>
      <div className="top"><span className="muted">{label}</span><span className="value">{rough}</span></div>
      <div className="track">
        <div className="fill" style={{ width: `${paramPos(maxB) * 100}%`, background: 'var(--e-model)' }} />
        {[8, 32, 70, 405].map((t) => <span key={t} className="tick" style={{ left: `${paramPos(t) * 100}%` }} />)}
      </div>
      <div className="labels" aria-hidden="true">{[8, 32, 70, 405].map((t) => <span key={t} style={{ left: `${paramPos(t) * 100}%` }}>{t}B</span>)}</div>
    </div>
  );
}

export function LinearBar({ value, max, label, display, color }: { value: number | null; max: number; label: string; display: string; color?: string }) {
  if (value == null) return <span className="faint">—</span>;
  return (
    <div className="linebar" role="img" aria-label={`${label}: ${display}`}>
      <div className="top"><span className="muted">{label}</span><span className="value">{display}</span></div>
      <div className="track"><div className="fill" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} /></div>
    </div>
  );
}

const monthShort = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

/** Monthly counts as labelled columns: readable at any width, latest month highlighted. HTML, so labels stay legible. */
export function MonthlyBars({ months, label }: { months: { month: string; count: number }[]; label: string }) {
  const max = Math.max(...months.map((m) => m.count), 1);
  return (
    <div className="monthly" role="img" aria-label={`${label}: ${months.map((m) => `${m.month} ${m.count}`).join(', ')}`}>
      {months.map((m, i) => (
        <div key={m.month} className={i === months.length - 1 ? 'col latest' : 'col'} aria-hidden="true">
          <span className="v">{m.count || ''}</span>
          <span className="bar"><i style={{ height: `${(m.count / max) * 100}%` }} /></span>
          <span className="m">{monthShort(m.month)}</span>
        </div>
      ))}
    </div>
  );
}
