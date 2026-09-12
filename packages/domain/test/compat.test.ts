import { describe, expect, it } from 'vitest';
import { evaluate, evaluateAcrossRuntimes, kvCacheGb, weightsGb, type ArtifactSpec, type DeviceSpec, type HardwareSpec, type RuntimeSpec } from '../src/compat';

const rtx4090: DeviceSpec = { id: 'rtx4090', name: 'RTX 4090', kind: 'gpu', memoryKind: 'dedicated', memoryGb: 24, memoryBandwidthGbps: 1008, backends: ['cuda', 'vulkan'] };
const rtx3090: DeviceSpec = { id: 'rtx3090', name: 'RTX 3090', kind: 'gpu', memoryKind: 'dedicated', memoryGb: 24, memoryBandwidthGbps: 936, backends: ['cuda', 'vulkan'] };
const m3max: DeviceSpec = { id: 'm3max', name: 'M3 Max', kind: 'soc', memoryKind: 'unified', memoryGb: null, memoryBandwidthGbps: 400, backends: ['metal', 'cpu'] };
const ryzen: DeviceSpec = { id: '7950x', name: 'Ryzen 9 7950X', kind: 'cpu', memoryKind: 'none', memoryGb: null, memoryBandwidthGbps: null, backends: ['cpu'] };

const single4090: HardwareSpec = { id: 'cfg-4090', components: [{ device: rtx4090, count: 1 }, { device: ryzen, count: 1 }], systemRamGb: 64, systemRamBandwidthGbps: 89.6, unifiedMemoryGb: null };
const dual3090: HardwareSpec = { id: 'cfg-2x3090', components: [{ device: rtx3090, count: 2 }, { device: ryzen, count: 1 }], systemRamGb: 128, systemRamBandwidthGbps: 89.6, unifiedMemoryGb: null };
const mbp64: HardwareSpec = { id: 'cfg-m3max-64', components: [{ device: m3max, count: 1 }], systemRamGb: 0, systemRamBandwidthGbps: null, unifiedMemoryGb: 64 };
const cpuOnly: HardwareSpec = { id: 'cfg-cpu', components: [{ device: ryzen, count: 1 }], systemRamGb: 128, systemRamBandwidthGbps: 89.6, unifiedMemoryGb: null };

const llamaCpp: RuntimeSpec = { id: 'llama.cpp', name: 'llama.cpp', formats: ['gguf'], backends: ['cuda', 'metal', 'rocm', 'vulkan', 'cpu'], supportsOffload: true, supportsMultiGpu: true };
const vllm: RuntimeSpec = { id: 'vllm', name: 'vLLM', formats: ['safetensors'], backends: ['cuda', 'rocm'], supportsOffload: false, supportsMultiGpu: true };
const mlxLm: RuntimeSpec = { id: 'mlx-lm', name: 'MLX-LM', formats: ['mlx'], backends: ['metal'], supportsOffload: false, supportsMultiGpu: false };

const llama8b = { paramsTotal: 8.03e9, paramsActive: null, layers: 32, kvHeads: 8, headDim: 128, kvBytesPerTokenOverride: null, contextLength: 131072 };
const llama70b = { paramsTotal: 70.6e9, paramsActive: null, layers: 80, kvHeads: 8, headDim: 128, kvBytesPerTokenOverride: null, contextLength: 131072 };
const qwen3moe = { paramsTotal: 30.5e9, paramsActive: 3.3e9, layers: 48, kvHeads: 4, headDim: 128, kvBytesPerTokenOverride: null, contextLength: 32768 };

const gguf = (id: string, model: ArtifactSpec['model'], bpw: number, sizeBytes: number | null = null): ArtifactSpec => ({ id, format: 'gguf', bitsPerWeight: bpw, sizeBytes, model });

describe('memory estimation', () => {
  it('computes GQA KV cache', () => {
    // Llama 3.1 8B: 2 * 32 layers * 8 kv heads * 128 dim * 2 bytes = 128 KiB per token
    expect(kvCacheGb(llama8b, 8192)).toBeCloseTo(1.0, 5);
  });

  it('honours per-model KV overrides (e.g. MLA)', () => {
    const mla = { ...llama70b, kvBytesPerTokenOverride: 70_000 };
    expect(kvCacheGb(mla, 1024)).toBeCloseTo((70_000 * 1024) / 1024 ** 3, 8);
  });

  it('prefers artifact size over params × bpw', () => {
    expect(weightsGb(gguf('a', llama8b, 4.89, 4_920_000_000))).toBeCloseTo(4.58, 2);
    expect(weightsGb(gguf('a', llama8b, 8))).toBeCloseTo(7.48, 2);
  });
});

describe('fit', () => {
  it('8B Q4 fits fully on a 4090', () => {
    const r = evaluate(single4090, gguf('l8-q4', llama8b, 4.89, 4_920_000_000), llamaCpp, { contextLength: 8192 });
    expect(r.fit).toBe('full');
    expect(r.placement).toBe('accelerator');
    expect(r.speed.basis).toBe('estimated');
  });

  it('70B Q4 offloads on a single 4090 with llama.cpp but not with vLLM', () => {
    const art = gguf('l70-q4', llama70b, 4.89);
    const cpp = evaluate(single4090, art, llamaCpp, { contextLength: 8192 });
    expect(cpp.fit).toBe('offload');
    expect(cpp.memory.offloadedGb).toBeGreaterThan(15);
    const v = evaluate(single4090, { ...art, format: 'safetensors' }, vllm, { contextLength: 8192 });
    expect(v.fit).toBe('none');
    expect(v.reasons.join()).toContain('cannot offload');
  });

  it('70B Q4 fits across two 3090s', () => {
    const r = evaluate(dual3090, gguf('l70-q4', llama70b, 4.89), llamaCpp, { contextLength: 8192 });
    expect(['full', 'tight']).toContain(r.fit);
    expect(r.memory.acceleratorUsableGb).toBeCloseTo(45.6, 1);
  });

  it('single-GPU runtimes only count one device', () => {
    const singleGpuRuntime = { ...llamaCpp, id: 'single', supportsMultiGpu: false, supportsOffload: false };
    const r = evaluate(dual3090, gguf('l70-q4', llama70b, 4.89), singleGpuRuntime, { contextLength: 8192 });
    expect(r.memory.acceleratorUsableGb).toBeCloseTo(22.8, 1);
    expect(r.fit).toBe('none');
  });

  it('uses the usable fraction of unified memory', () => {
    const r = evaluate(mbp64, gguf('l70-q4', llama70b, 4.89), llamaCpp, { contextLength: 4096 });
    expect(r.memory.acceleratorUsableGb).toBe(48);
    expect(r.fit).toBe('tight');
    expect(r.memory.systemUsableGb).toBe(0);
  });

  it('long context can push a model out of memory', () => {
    const art = gguf('l8-q8', llama8b, 8.5);
    expect(evaluate(single4090, art, { ...llamaCpp, supportsOffload: false }, { contextLength: 8192 }).fit).toBe('full');
    expect(evaluate(single4090, art, { ...llamaCpp, supportsOffload: false }, { contextLength: 131072 }).fit).toBe('none');
  });

  it('caps context at the model maximum', () => {
    const r = evaluate(single4090, gguf('q3', qwen3moe, 4.89), llamaCpp, { contextLength: 200_000 });
    expect(r.contextLength).toBe(32768);
    expect(r.reasons[0]).toContain('capped');
  });

  it('CPU-only systems run in system RAM', () => {
    const r = evaluate(cpuOnly, gguf('l8-q4', llama8b, 4.89), llamaCpp, { contextLength: 4096 });
    expect(r.fit).toBe('full');
    expect(r.placement).toBe('cpu');
    expect(r.speed.basis).toBe('estimated');
  });

  it('format and backend mismatches are incompatible with reasons', () => {
    expect(evaluate(single4090, gguf('x', llama8b, 4.89), mlxLm, { contextLength: 4096 }).reasons.join()).toContain('does not load gguf');
    const mlxArt: ArtifactSpec = { id: 'mlx', format: 'mlx', bitsPerWeight: 4.5, sizeBytes: null, model: llama8b };
    const r = evaluate(single4090, mlxArt, mlxLm, { contextLength: 4096 });
    expect(r.fit).toBe('none');
    expect(r.reasons.join()).toContain('no supported backend');
  });
});

describe('speed', () => {
  it('estimates land in a realistic range (bandwidth-bound decode)', () => {
    const r = evaluate(single4090, gguf('l8-q4', llama8b, 4.89, 4_920_000_000), llamaCpp, { contextLength: 4096 });
    if (r.speed.basis !== 'estimated') throw new Error('expected estimate');
    expect(r.speed.genTps).toBeGreaterThan(80);
    expect(r.speed.genTps).toBeLessThan(200);
    expect(r.speed.low).toBeLessThan(r.speed.genTps);
  });

  it('MoE models decode faster than dense models of the same size', () => {
    const dense = evaluate(single4090, gguf('d', { ...qwen3moe, paramsActive: null }, 4.89), llamaCpp, { contextLength: 4096 });
    const moe = evaluate(single4090, gguf('m', qwen3moe, 4.89), llamaCpp, { contextLength: 4096 });
    if (dense.speed.basis !== 'estimated' || moe.speed.basis !== 'estimated') throw new Error('expected estimates');
    expect(moe.speed.genTps).toBeGreaterThan(dense.speed.genTps * 3);
  });

  it('offloading is much slower than full GPU placement', () => {
    const art = gguf('l70-q4', llama70b, 4.89);
    const offload = evaluate(single4090, art, llamaCpp, { contextLength: 4096 });
    const dual = evaluate(dual3090, art, llamaCpp, { contextLength: 4096 });
    if (offload.speed.basis !== 'estimated' || dual.speed.basis !== 'estimated') throw new Error('expected estimates');
    expect(dual.speed.genTps).toBeGreaterThan(offload.speed.genTps * 2);
  });

  it('measured results replace estimates and only match the same config/artifact/runtime', () => {
    const art = gguf('l8-q4', llama8b, 4.89);
    const measurements = [
      { hardwareConfigurationId: 'cfg-4090', artifactId: 'l8-q4', runtimeId: 'llama.cpp', contextLength: 4096, genTps: 120, promptTps: 4000, origin: 'community_verified' as const },
      { hardwareConfigurationId: 'cfg-4090', artifactId: 'l8-q4', runtimeId: 'llama.cpp', contextLength: 4096, genTps: 130, promptTps: null, origin: 'canonical' as const },
      { hardwareConfigurationId: 'cfg-4090', artifactId: 'l8-q4', runtimeId: 'llama.cpp', contextLength: 4096, genTps: 200, promptTps: 5000, origin: 'community_verified' as const },
      { hardwareConfigurationId: 'cfg-2x3090', artifactId: 'l8-q4', runtimeId: 'llama.cpp', contextLength: 4096, genTps: 999, promptTps: null, origin: 'canonical' as const },
    ];
    const r = evaluate(single4090, art, llamaCpp, { contextLength: 4096, measurements });
    expect(r.speed).toEqual({ basis: 'measured', genTps: 130, promptTps: 4500, samples: 3, origins: ['community_verified', 'canonical'] });
  });

  it('never reports speed for incompatible results', () => {
    const r = evaluate(cpuOnly, gguf('l70-f16', llama70b, 16), llamaCpp, { contextLength: 4096 });
    expect(r.fit).toBe('none');
    expect(r.speed.basis).toBe('unknown');
  });
});

describe('evaluateAcrossRuntimes', () => {
  it('orders viable runtimes first', () => {
    const results = evaluateAcrossRuntimes(single4090, gguf('l8', llama8b, 4.89), [mlxLm, vllm, llamaCpp], { contextLength: 4096 });
    expect(results[0]!.runtimeId).toBe('llama.cpp');
    expect(results.slice(1).every((r) => r.fit === 'none')).toBe(true);
  });
});
