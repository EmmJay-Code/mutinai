import type { catalog } from '@mutinai/db';
import { compat } from '@mutinai/domain';

/** GiB per billion parameters for a typical 4-bit (Q4_K_M) download. */
const GIB_PER_B_Q4 = ((4.89 / 8) * 1e9) / 1024 ** 3;
/** Headroom for KV cache at modest context plus runtime overhead. */
const WORKING_GB = 2;

/** Rough largest dense model (billions of parameters) that fits at 4-bit. For orientation only. */
export function maxParamsAtQ4(usableGb: number): number {
  return Math.max(0, (usableGb - WORKING_GB) / (GIB_PER_B_Q4 * (1 + compat.COMPAT_CONSTANTS.overheadPerWeightGb)));
}

export function roughParams(b: number): string {
  if (b < 1) return 'under 1B';
  if (b >= 100) return `~${Math.round(b / 10) * 10}B`;
  return `~${Math.floor(b)}B`;
}

export const DEVICE_KIND_LABEL: Record<string, string> = { gpu: 'GPU', soc: 'SoC / APU', cpu: 'CPU', accelerator: 'Accelerator' };

export const BACKEND_LABEL: Record<string, string> = {
  cuda: 'NVIDIA GPUs',
  rocm: 'AMD GPUs',
  metal: 'Apple silicon',
  vulkan: 'most GPUs (Vulkan)',
  cpu: 'CPUs',
};

export function deviceSentence(d: catalog.DeviceDTO): string {
  const bw = d.memoryBandwidthGbps ? `${d.memoryBandwidthGbps.toLocaleString('en-US')} GB/s` : null;
  if (d.memoryKind === 'dedicated' && d.memoryGb) {
    const max = maxParamsAtQ4(d.memoryGb * compat.COMPAT_CONSTANTS.dedicatedUsableFraction);
    return `${d.memoryGb} GB of ${d.memoryType ?? 'dedicated'} memory${bw ? ` at ${bw}` : ''} — enough for models up to ${roughParams(max)} parameters at 4-bit on one card.`;
  }
  if (d.memoryKind === 'unified') {
    return `Shares one pool of ${d.memoryType ?? 'unified'} memory between CPU and GPU${bw ? ` at ${bw}` : ''}. What fits depends on how much memory the system has.`;
  }
  return 'Runs models from system RAM. Slower than a GPU, but not limited by graphics memory.';
}

export function systemUsableGb(c: catalog.ConfigurationDTO): { gb: number; where: 'accelerator' | 'unified' | 'ram' } {
  if (c.unifiedMemoryGb) return { gb: c.unifiedMemoryGb * compat.COMPAT_CONSTANTS.defaultUnifiedUsableFraction, where: 'unified' };
  const dedicated = c.components.reduce((s, x) => s + (x.memoryKind === 'dedicated' ? (x.memoryGb ?? 0) * x.count : 0), 0);
  if (dedicated) return { gb: dedicated * compat.COMPAT_CONSTANTS.dedicatedUsableFraction, where: 'accelerator' };
  return { gb: c.systemRamGb * compat.COMPAT_CONSTANTS.systemRamUsableFraction, where: 'ram' };
}

export function systemSentence(c: catalog.ConfigurationDTO): string {
  const { gb, where } = systemUsableGb(c);
  const place = where === 'ram' ? 'in system RAM (CPU only)' : where === 'unified' ? 'in unified memory' : 'entirely on the GPU';
  return `Runs models up to ${roughParams(maxParamsAtQ4(gb))} parameters at 4-bit ${place}.`;
}

/** Price per GB of accelerator memory, when both are known. */
export function pricePerGb(priceUsd: number | null | undefined, memoryGb: number | null | undefined): number | null {
  return priceUsd && memoryGb ? Math.round(priceUsd / memoryGb) : null;
}
