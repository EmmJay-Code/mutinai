/**
 * "What can I run?" compatibility engine. Pure and deterministic.
 * See docs/adr/0006-compatibility-engine.md.
 *
 * Units: memory in GiB (device "24 GB" VRAM is 24 GiB); bandwidth in GB/s as vendors quote it.
 */
import type { ComputeBackend, DeviceKind, MemoryKind, WeightFormat } from './ontology';

const GIB = 1024 ** 3;

export interface DeviceSpec {
  id: string;
  name: string;
  kind: DeviceKind;
  memoryKind: MemoryKind;
  /** Dedicated memory per device. Null for unified/none. */
  memoryGb: number | null;
  memoryBandwidthGbps: number | null;
  backends: readonly ComputeBackend[];
  /** Fraction of unified memory the OS lets the accelerator use by default. */
  unifiedUsableFraction?: number | null;
}

export interface HardwareSpec {
  id: string;
  components: readonly { device: DeviceSpec; count: number }[];
  /** System RAM not shared with an accelerator. 0 for unified-memory systems. */
  systemRamGb: number;
  systemRamBandwidthGbps: number | null;
  /** Unified memory size for SoC systems. */
  unifiedMemoryGb: number | null;
}

export interface ModelSpec {
  paramsTotal: number;
  paramsActive: number | null;
  layers: number;
  kvHeads: number;
  headDim: number;
  /** For architectures where the standard GQA formula is wrong (e.g. MLA). fp16 bytes per token. */
  kvBytesPerTokenOverride: number | null;
  contextLength: number;
}

export interface ArtifactSpec {
  id: string;
  format: WeightFormat;
  bitsPerWeight: number;
  sizeBytes: number | null;
  model: ModelSpec;
}

export interface RuntimeSpec {
  id: string;
  name: string;
  formats: readonly WeightFormat[];
  backends: readonly ComputeBackend[];
  supportsOffload: boolean;
  supportsMultiGpu: boolean;
}

export interface Measurement {
  hardwareConfigurationId: string;
  artifactId: string;
  runtimeId: string;
  contextLength: number | null;
  genTps: number | null;
  promptTps: number | null;
  origin: 'canonical' | 'community_verified';
}

export type Fit = 'full' | 'tight' | 'offload' | 'none';
export type Placement = 'accelerator' | 'hybrid' | 'cpu' | null;

export interface MemoryBreakdown {
  weightsGb: number;
  kvCacheGb: number;
  overheadGb: number;
  totalGb: number;
  acceleratorUsableGb: number;
  systemUsableGb: number;
  offloadedGb: number;
}

export type SpeedAssessment =
  | { basis: 'measured'; genTps: number | null; promptTps: number | null; samples: number; origins: Measurement['origin'][] }
  | { basis: 'estimated'; genTps: number; low: number; high: number }
  | { basis: 'unknown' };

export interface CompatResult {
  artifactId: string;
  runtimeId: string;
  fit: Fit;
  placement: Placement;
  contextLength: number;
  memory: MemoryBreakdown;
  speed: SpeedAssessment;
  reasons: string[];
}

export const COMPAT_CONSTANTS = {
  defaultUnifiedUsableFraction: 0.75,
  dedicatedUsableFraction: 0.95,
  systemRamUsableFraction: 0.8,
  tightThreshold: 0.9,
  baseOverheadGb: 0.5,
  overheadPerWeightGb: 0.04,
  /** Share of theoretical bandwidth-bound throughput realised in practice. */
  decodeEfficiency: 0.65,
  /** Non-expert / attention bytes read per token regardless of sparsity. */
  perTokenFixedReadGb: 0.5,
  multiDevicePenalty: 0.05,
  estimateSpread: 0.35,
} as const;

export function weightsGb(a: ArtifactSpec): number {
  const bytes = a.sizeBytes ?? (a.model.paramsTotal * a.bitsPerWeight) / 8;
  return bytes / GIB;
}

export function kvCacheGb(model: ModelSpec, contextLength: number, bytesPerElement = 2): number {
  const perToken = model.kvBytesPerTokenOverride != null
    ? (model.kvBytesPerTokenOverride * bytesPerElement) / 2
    : 2 * model.layers * model.kvHeads * model.headDim * bytesPerElement;
  return (perToken * contextLength) / GIB;
}

interface Pool {
  gb: number;
  bandwidth: number | null;
}

interface AcceleratorPools {
  pools: Pool[];
  backends: Set<ComputeBackend>;
}

/** Accelerator memory usable by a runtime: devices whose backends the runtime supports. */
function acceleratorPools(hw: HardwareSpec, runtime: RuntimeSpec): AcceleratorPools {
  const pools: Pool[] = [];
  const backends = new Set<ComputeBackend>();
  for (const { device, count } of hw.components) {
    const shared = device.backends.filter((b) => b !== 'cpu' && runtime.backends.includes(b));
    if (!shared.length) continue;
    shared.forEach((b) => backends.add(b));
    if (device.memoryKind === 'dedicated' && device.memoryGb) {
      for (let i = 0; i < count; i++) {
        pools.push({ gb: device.memoryGb * COMPAT_CONSTANTS.dedicatedUsableFraction, bandwidth: device.memoryBandwidthGbps });
      }
    } else if (device.memoryKind === 'unified' && hw.unifiedMemoryGb) {
      const fraction = device.unifiedUsableFraction ?? COMPAT_CONSTANTS.defaultUnifiedUsableFraction;
      pools.push({ gb: hw.unifiedMemoryGb * fraction, bandwidth: device.memoryBandwidthGbps });
    }
  }
  if (!runtime.supportsMultiGpu && pools.length > 1) {
    pools.sort((a, b) => b.gb - a.gb);
    pools.splice(1);
  }
  return { pools, backends };
}

function cpuAvailable(hw: HardwareSpec, runtime: RuntimeSpec): boolean {
  if (!runtime.backends.includes('cpu')) return false;
  return hw.components.some((c) => c.device.backends.includes('cpu')) || hw.systemRamGb > 0;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export interface EvaluateOptions {
  contextLength: number;
  measurements?: readonly Measurement[];
}

export function evaluate(hw: HardwareSpec, artifact: ArtifactSpec, runtime: RuntimeSpec, opts: EvaluateOptions): CompatResult {
  const C = COMPAT_CONSTANTS;
  const reasons: string[] = [];
  const contextLength = Math.min(opts.contextLength, artifact.model.contextLength);
  if (contextLength < opts.contextLength) reasons.push(`context capped at model maximum ${artifact.model.contextLength}`);

  const w = weightsGb(artifact);
  const kv = kvCacheGb(artifact.model, contextLength);
  const overhead = C.baseOverheadGb + w * C.overheadPerWeightGb;
  const total = w + kv + overhead;

  const { pools } = acceleratorPools(hw, runtime);
  const accelGb = pools.reduce((s, p) => s + p.gb, 0);
  const systemGb = hw.systemRamGb * C.systemRamUsableFraction;
  const memory: MemoryBreakdown = {
    weightsGb: round(w),
    kvCacheGb: round(kv),
    overheadGb: round(overhead),
    totalGb: round(total),
    acceleratorUsableGb: round(accelGb),
    systemUsableGb: round(systemGb),
    offloadedGb: 0,
  };

  const base = { artifactId: artifact.id, runtimeId: runtime.id, contextLength, memory };

  if (!runtime.formats.includes(artifact.format)) {
    return { ...base, fit: 'none', placement: null, speed: { basis: 'unknown' }, reasons: [...reasons, `${runtime.name} does not load ${artifact.format} weights`] };
  }
  const cpu = cpuAvailable(hw, runtime);
  if (!pools.length && !cpu) {
    return { ...base, fit: 'none', placement: null, speed: { basis: 'unknown' }, reasons: [...reasons, `${runtime.name} has no supported backend on this hardware`] };
  }

  let fit: Fit;
  let placement: Placement;
  let offloaded = 0;
  if (pools.length && total <= accelGb) {
    fit = total / accelGb > C.tightThreshold ? 'tight' : 'full';
    placement = 'accelerator';
  } else if (!pools.length && total <= systemGb) {
    fit = total / systemGb > C.tightThreshold ? 'tight' : 'full';
    placement = 'cpu';
    reasons.push('runs on CPU and system RAM only');
  } else if (pools.length && cpu && runtime.supportsOffload && total <= accelGb + systemGb) {
    fit = 'offload';
    placement = 'hybrid';
    offloaded = total - accelGb;
    reasons.push(`${round(offloaded, 1)} GiB offloaded to system RAM`);
  } else {
    fit = 'none';
    placement = null;
    if (pools.length && !runtime.supportsOffload && total <= accelGb + systemGb) {
      reasons.push(`needs ${round(total, 1)} GiB; ${runtime.name} cannot offload to system RAM`);
    } else {
      reasons.push(`needs ${round(total, 1)} GiB; ${round(accelGb + (runtime.supportsOffload ? systemGb : 0), 1)} GiB usable`);
    }
  }
  memory.offloadedGb = round(offloaded);

  const result: CompatResult = { ...base, fit, placement, speed: { basis: 'unknown' }, reasons };
  if (fit === 'none') return result;

  const measured = (opts.measurements ?? []).filter(
    (m) => m.hardwareConfigurationId === hw.id && m.artifactId === artifact.id && m.runtimeId === runtime.id,
  );
  if (measured.length) {
    result.speed = {
      basis: 'measured',
      genTps: median(measured.flatMap((m) => (m.genTps != null ? [m.genTps] : []))),
      promptTps: median(measured.flatMap((m) => (m.promptTps != null ? [m.promptTps] : []))),
      samples: measured.length,
      origins: [...new Set(measured.map((m) => m.origin))],
    };
    return result;
  }

  const estimate = estimateDecodeTps({ artifact, weights: w, pools, placement: placement!, offloaded, hw });
  if (estimate != null) {
    result.speed = { basis: 'estimated', genTps: round(estimate, 1), low: round(estimate * (1 - C.estimateSpread), 1), high: round(estimate * (1 + C.estimateSpread), 1) };
  }
  return result;
}

function estimateDecodeTps(args: { artifact: ArtifactSpec; weights: number; pools: Pool[]; placement: Exclude<Placement, null>; offloaded: number; hw: HardwareSpec }): number | null {
  const C = COMPAT_CONSTANTS;
  const { artifact, weights, pools, placement, offloaded, hw } = args;
  const activeRatio = artifact.model.paramsActive ? artifact.model.paramsActive / artifact.model.paramsTotal : 1;
  const readGb = weights * activeRatio + C.perTokenFixedReadGb;

  // Per-token time is the sum over memory pools of (bytes read from that pool / bandwidth).
  const segments: { share: number; bandwidth: number | null }[] = [];
  if (placement === 'cpu') {
    segments.push({ share: 1, bandwidth: hw.systemRamBandwidthGbps });
  } else {
    const onAccel = weights - (placement === 'hybrid' ? Math.min(offloaded, weights) : 0);
    const accelTotal = pools.reduce((s, p) => s + p.gb, 0);
    for (const p of pools) segments.push({ share: (onAccel / weights) * (p.gb / accelTotal), bandwidth: p.bandwidth });
    if (placement === 'hybrid') segments.push({ share: 1 - onAccel / weights, bandwidth: hw.systemRamBandwidthGbps });
  }
  if (segments.some((s) => s.share > 0 && !s.bandwidth)) return null;
  const secondsPerToken = segments.reduce((t, s) => t + (s.share > 0 ? (readGb * s.share) / (C.decodeEfficiency * s.bandwidth!) : 0), 0);
  // Bandwidth is quoted in GB/s; readGb is GiB — convert to keep units honest.
  const tps = 1 / (secondsPerToken * (GIB / 1e9));
  const devices = placement === 'cpu' ? 1 : pools.length;
  return tps * (1 - C.multiDevicePenalty * Math.max(0, devices - 1));
}

const FIT_RANK: Record<Fit, number> = { full: 3, tight: 2, offload: 1, none: 0 };

function speedValue(s: SpeedAssessment): number {
  if (s.basis === 'measured') return s.genTps ?? 0;
  if (s.basis === 'estimated') return s.genTps;
  return 0;
}

/**
 * A measurement outranks an estimate. Estimates are bandwidth arithmetic and can run well above what anyone has
 * observed, so ranking by the number alone let an estimate for one runtime displace a measurement of the same file on
 * the same system with another — and the page then showed a figure the measurement below it contradicted.
 */
const BASIS_RANK: Record<SpeedAssessment['basis'], number> = { measured: 2, estimated: 1, unknown: 0 };

export function compareResults(a: CompatResult, b: CompatResult): number {
  return FIT_RANK[b.fit] - FIT_RANK[a.fit] || BASIS_RANK[b.speed.basis] - BASIS_RANK[a.speed.basis] || speedValue(b.speed) - speedValue(a.speed);
}

/** Evaluate an artifact against every runtime and return the best viable result first. */
export function evaluateAcrossRuntimes(hw: HardwareSpec, artifact: ArtifactSpec, runtimes: readonly RuntimeSpec[], opts: EvaluateOptions): CompatResult[] {
  return runtimes.map((r) => evaluate(hw, artifact, r, opts)).sort(compareResults);
}

export function hardwareSummary(hw: HardwareSpec) {
  const accelerators = hw.components.filter((c) => c.device.memoryKind !== 'none');
  const dedicatedGb = accelerators.reduce((s, c) => s + (c.device.memoryKind === 'dedicated' ? (c.device.memoryGb ?? 0) * c.count : 0), 0);
  const backends = [...new Set(hw.components.flatMap((c) => c.device.backends))];
  return { dedicatedGb, unifiedGb: hw.unifiedMemoryGb, systemRamGb: hw.systemRamGb, backends };
}

export interface Candidate<T> {
  payload: T;
  bitsPerWeight: number;
  result: CompatResult;
}

/** Above ~8.5 bits per weight, quality gains are negligible for inference; prefer speed instead. */
export const QUALITY_BPW_CEILING = 8.5;

/**
 * Chooses the artifact to recommend for one variant on one hardware configuration:
 * among artifacts that fit in accelerator (or CPU) memory, prefer one that has been measured on this system, then
 * higher effective precision, then roomier fit, then speed. Only if nothing fits without offload, prefer the fastest
 * offloaded option, measured before estimated. A measured option wins over a higher-precision estimated one so that a
 * page never recommends an estimate beside the measurement that contradicts it.
 */
export function pickRecommended<T>(candidates: readonly Candidate<T>[]): Candidate<T> | null {
  const viable = candidates.filter((c) => c.result.fit !== 'none');
  if (!viable.length) return null;
  const inMemory = viable.filter((c) => c.result.fit === 'full' || c.result.fit === 'tight');
  if (inMemory.length) {
    return [...inMemory].sort(
      (a, b) =>
        BASIS_RANK[b.result.speed.basis] - BASIS_RANK[a.result.speed.basis] ||
        Math.min(b.bitsPerWeight, QUALITY_BPW_CEILING) - Math.min(a.bitsPerWeight, QUALITY_BPW_CEILING) ||
        FIT_RANK[b.result.fit] - FIT_RANK[a.result.fit] ||
        speedValue(b.result.speed) - speedValue(a.result.speed),
    )[0]!;
  }
  return [...viable].sort((a, b) => BASIS_RANK[b.result.speed.basis] - BASIS_RANK[a.result.speed.basis] || speedValue(b.result.speed) - speedValue(a.result.speed) || b.bitsPerWeight - a.bitsPerWeight)[0]!;
}
