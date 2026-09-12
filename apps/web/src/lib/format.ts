const GIB = 1024 ** 3;

export function formatParams(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e11 ? 0 : n >= 1e10 ? 1 : 2).replace(/\.?0+$/, '')}B`;
  return `${(n / 1e6).toFixed(0)}M`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  const gib = bytes / GIB;
  return gib >= 100 ? `${gib.toFixed(0)} GiB` : `${gib.toFixed(1)} GiB`;
}

export function formatGb(gb: number | null | undefined, digits = 1): string {
  if (gb == null) return '—';
  return `${Number.isInteger(gb) ? gb : gb.toFixed(digits)} GB`;
}

export function formatContext(tokens: number | null | undefined): string {
  if (tokens == null) return '—';
  return tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : String(tokens);
}

export function formatNumber(n: number | null | undefined, digits = 1): string {
  if (n == null) return '—';
  if (n >= 1000) return Math.round(n).toLocaleString('en-US');
  return n.toFixed(n >= 100 ? 0 : digits).replace(/\.0$/, '');
}

export function formatDate(value: string | Date | null | undefined, style: 'short' | 'long' = 'short'): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value) : value;
  return d.toLocaleDateString('en-GB', style === 'short' ? { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' } : { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function isoDate(value: string | Date): string {
  return (typeof value === 'string' ? new Date(value) : value).toISOString().slice(0, 10);
}

export const humanize = (s: string) => s.replace(/_/g, ' ');

export const KIND_LABEL: Record<string, string> = {
  organization: 'Organization',
  model_family: 'Family',
  model_release: 'Release',
  model: 'Model',
  model_variant: 'Variant',
  model_artifact: 'Quantization',
  quantization_scheme: 'Quant scheme',
  hardware_device: 'Hardware',
  hardware_configuration: 'System',
  project: 'Tool',
  benchmark: 'Benchmark',
};

/** Canonical URL for an entity. Variants and artifacts live on their model page. */
export function entityHref(e: { kind: string; slug: string; modelSlug?: string | null }): string | null {
  switch (e.kind) {
    case 'model':
      return `/models/${e.slug}`;
    case 'model_variant':
      return e.modelSlug ? `/models/${e.modelSlug}#${e.slug}` : null;
    case 'model_artifact':
      return e.modelSlug ? `/models/${e.modelSlug}#${e.slug}` : null;
    case 'model_release':
    case 'model_family':
      return `/models?${e.kind === 'model_family' ? 'family' : 'q'}=${encodeURIComponent(e.slug)}`;
    case 'organization':
      return `/models?developer=${encodeURIComponent(e.slug)}`;
    case 'hardware_device':
      return `/hardware/${e.slug}`;
    case 'hardware_configuration':
      return `/hardware/systems/${e.slug}`;
    case 'project':
      return `/tools/${e.slug}`;
    default:
      return null;
  }
}

export function searchParam(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

export function numberParam(sp: Record<string, string | string[] | undefined>, key: string): number | undefined {
  const v = searchParam(sp, key);
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
