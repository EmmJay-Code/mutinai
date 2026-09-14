/**
 * Editorial hardware specifications, imported from a CSV a person researched.
 *
 * Device specs have no API worth trusting (see docs/hardware-data.md), so they stay editorial: someone reads the
 * manufacturer's own page and records what it says. This adapter is the door that work comes through, and it exists
 * to hold two rules that are easy to break by hand:
 *
 * 1. **A value without a page is not a fact.** Every row cites the URL it was read from, and a row without one is
 *    refused. Because provenance is recorded per source record, one row is one page: specs from a spec page and a
 *    price from a launch announcement are two rows for the same device, and each field then cites where it came from.
 * 2. **A blank is a blank.** An empty cell means the page did not state it, and nothing is written for that field —
 *    never a default, never a guess, never a value carried over from another row.
 *
 * Implausible numbers are refused rather than stored, so a typo surfaces as a review item instead of a spec.
 */
import { readFile } from 'node:fs/promises';
import { COMPUTE_BACKENDS, DEVICE_KINDS, MEMORY_KINDS, slugify, type ComputeBackend, type DeviceKind, type MemoryKind } from '@mutinai/domain';
import type { HardwareDeviceRecord, HardwareSpecField, NormalizedRecord, RawItem, SourceAdapter, SourceDescriptor } from '../adapter';

export const HARDWARE_SPECS_SOURCE: SourceDescriptor = {
  key: 'editorial-hardware-specs',
  name: 'Manufacturer specifications (editorial)',
  kind: 'editorial',
  // Above every automated source: a person read the manufacturer's page, so this wins on conflict.
  priority: 100,
};

/** A row as it appears in the file, before any interpretation. Header names are matched loosely; see `HEADERS`. */
export interface HardwareSpecRow {
  slug?: string;
  name: string;
  manufacturer: string;
  deviceKind?: string;
  memoryKind?: string;
  backends?: string;
  memoryGb?: string;
  memoryType?: string;
  bandwidthGbps?: string;
  tdpWatts?: string;
  releaseDate?: string;
  launchPriceUsd?: string;
  sourceUrl: string;
}

/** Accepted spellings per column. Compared with punctuation and spacing removed, so "Bandwidth GB/s" matches "bandwidth_gbps". */
const HEADERS: Record<keyof HardwareSpecRow, string[]> = {
  slug: ['slug', 'id'],
  name: ['fullname', 'name', 'device', 'product'],
  manufacturer: ['manufacturer', 'vendor', 'brand', 'maker'],
  deviceKind: ['devicekind', 'kind', 'class'],
  memoryKind: ['memorykind'],
  backends: ['backends', 'runson', 'apis'],
  memoryGb: ['memorygb', 'memory', 'vram', 'memorysize'],
  memoryType: ['memorytype'],
  bandwidthGbps: ['bandwidthgbs', 'bandwidth', 'memorybandwidth', 'memorybandwidthgbs', 'memoryspeed'],
  tdpWatts: ['tdpwatts', 'tdp', 'power', 'tgp', 'totalgraphicspower', 'totalboardpower'],
  releaseDate: ['releasedate', 'released', 'launchdate'],
  launchPriceUsd: ['launchpriceusd', 'launchprice', 'price', 'msrp'],
  sourceUrl: ['sourceurl', 'source', 'url', 'citation'],
};

const key = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF. No dependency, no cleverness. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;
  const endField = () => { row.push(field); field = ''; started = false; };
  const endRow = () => { endField(); if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && !started) { quoted = true; started = true; }
    else if (c === ',') endField();
    else if (c === '\n') endRow();
    else if (c === '\r') continue;
    else { field += c; started = true; }
  }
  endRow();
  return rows;
}

export function readHardwareSpecCsv(text: string): HardwareSpecRow[] {
  const [header, ...lines] = parseCsv(text);
  if (!header) return [];
  const columns = header.map(key);
  const index = Object.fromEntries(
    Object.entries(HEADERS).map(([field, names]) => [field, columns.findIndex((c) => names.includes(c))]),
  ) as Record<keyof HardwareSpecRow, number>;
  const missing = (['name', 'manufacturer', 'sourceUrl'] as const).filter((f) => index[f] < 0);
  if (missing.length) throw new Error(`hardware spec CSV is missing required column(s): ${missing.join(', ')}. Header was: ${header.join(', ')}`);
  return lines.map((cells) => {
    const at = (f: keyof HardwareSpecRow) => (index[f] >= 0 ? cells[index[f]]?.trim() || undefined : undefined);
    return {
      slug: at('slug'), name: at('name') ?? '', manufacturer: at('manufacturer') ?? '',
      deviceKind: at('deviceKind'), memoryKind: at('memoryKind'), backends: at('backends'),
      memoryGb: at('memoryGb'), memoryType: at('memoryType'), bandwidthGbps: at('bandwidthGbps'),
      tdpWatts: at('tdpWatts'), releaseDate: at('releaseDate'), launchPriceUsd: at('launchPriceUsd'),
      sourceUrl: at('sourceUrl') ?? '',
    };
  });
}

/** `$1,599` / `1 008` / `24 GB` → a number. Anything that is not plainly a number is rejected, not coerced. */
function number(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/(gb\/s|gb|w|watts|usd)$/i, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** ISO (`2022-12-13`) or US (`12/13/2022`). Ambiguous or invalid dates are rejected. */
function isoDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  const [y, m, d] = iso ? [iso[1]!, iso[2]!, iso[3]!] : us ? [us[3]!, us[1]!.padStart(2, '0'), us[2]!.padStart(2, '0')] : [];
  if (!y) return null;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${y}-${m}-${d}`) return null;
  return `${y}-${m}-${d}`;
}

/** Ranges wide enough for anything real and tight enough to catch a slipped decimal or a pasted wrong column. */
const PLAUSIBLE: Record<string, [number, number]> = {
  memoryGb: [1, 4096],
  memoryBandwidthGbps: [1, 100_000],
  tdpWatts: [1, 5_000],
  launchPriceUsd: [1, 1_000_000],
};

export interface HardwareSpecIssue {
  row: number;
  name: string;
  problem: string;
}

/** A cell that is empty or only whitespace said nothing, exactly like a missing column. */
const stated = (raw: string | undefined) => (raw != null && raw.trim() !== '' ? raw.trim() : undefined);

/** Turns one row into a record, or reports why it cannot be one. Pure, so the rules are testable without a database. */
export function normalizeHardwareSpecRow(row: HardwareSpecRow, rowNumber = 0): { record: HardwareDeviceRecord } | { issue: HardwareSpecIssue } {
  const problem = (p: string) => ({ issue: { row: rowNumber, name: row.name || '(unnamed)', problem: p } });
  if (!stated(row.name)) return problem('no device name');
  if (!stated(row.sourceUrl)) return problem('no source URL: a value without a page it was read from is not a fact');
  if (!/^https?:\/\//i.test(row.sourceUrl)) return problem(`source URL is not a URL (${row.sourceUrl})`);
  if (!stated(row.manufacturer)) return problem('no manufacturer');

  const facts: { field: HardwareSpecField; value: string | number }[] = [];
  const numeric: [HardwareSpecField, string | undefined][] = [
    ['memoryGb', stated(row.memoryGb)], ['memoryBandwidthGbps', stated(row.bandwidthGbps)], ['tdpWatts', stated(row.tdpWatts)], ['launchPriceUsd', stated(row.launchPriceUsd)],
  ];
  for (const [field, raw] of numeric) {
    if (raw == null) continue; // Blank: the page did not state it.
    const value = number(raw);
    if (value == null) return problem(`${field}: "${raw}" is not a number`);
    const [min, max] = PLAUSIBLE[field]!;
    if (value < min || value > max) return problem(`${field}: ${value} is outside the plausible range ${min}–${max}`);
    facts.push({ field, value });
  }
  if (stated(row.memoryType)) facts.push({ field: 'memoryType', value: stated(row.memoryType)! });
  if (stated(row.releaseDate) != null) {
    const date = isoDate(row.releaseDate);
    if (!date) return problem(`releaseDate: "${row.releaseDate}" is not an ISO (2022-12-13) or US (12/13/2022) date`);
    if (Number(date.slice(0, 4)) < 1990 || new Date(date).getTime() > Date.now() + 365 * 86_400_000) return problem(`releaseDate: ${date} is not a plausible launch date`);
    facts.push({ field: 'releasedOn', value: date });
  }
  if (!facts.length) return problem('no specifications stated: every column was blank');

  let classification: HardwareDeviceRecord['classification'];
  if (stated(row.deviceKind) || stated(row.memoryKind) || stated(row.backends)) {
    const deviceKind = row.deviceKind?.toLowerCase().trim();
    const memoryKind = row.memoryKind?.toLowerCase().trim();
    const backends = (row.backends ?? '').split(/[;,|]/).map((b) => b.toLowerCase().trim()).filter(Boolean);
    if (!deviceKind || !(DEVICE_KINDS as readonly string[]).includes(deviceKind)) return problem(`deviceKind must be one of ${DEVICE_KINDS.join(', ')} (got "${row.deviceKind ?? ''}")`);
    if (!memoryKind || !(MEMORY_KINDS as readonly string[]).includes(memoryKind)) return problem(`memoryKind must be one of ${MEMORY_KINDS.join(', ')} (got "${row.memoryKind ?? ''}")`);
    const unknown = backends.filter((b) => !(COMPUTE_BACKENDS as readonly string[]).includes(b));
    if (!backends.length || unknown.length) return problem(`backends must be from ${COMPUTE_BACKENDS.join(', ')} (got "${row.backends ?? ''}")`);
    classification = { deviceKind: deviceKind as DeviceKind, memoryKind: memoryKind as MemoryKind, backends: backends as ComputeBackend[] };
    // Dedicated memory is fixed on the device and must be stated; unified and RAM-only devices are sized by the
    // machine they go in, so a figure there would belong to a system rather than the chip (see the ontology's
    // hardware_device_dedicated_memory rule).
    const statesMemory = facts.some((f) => f.field === 'memoryGb');
    if (classification.memoryKind === 'dedicated' && !statesMemory) return problem('memoryKind is dedicated, so the page must also state memory size');
    if (classification.memoryKind !== 'dedicated' && statesMemory) return problem(`memoryKind is ${classification.memoryKind}, so memory size belongs to the system, not the device`);
  }

  return {
    record: {
      type: 'hardware_device',
      identifier: { namespace: 'editorial-hardware', value: row.slug ?? slugify(row.name), url: row.sourceUrl },
      name: row.name,
      vendor: { name: row.manufacturer },
      classification,
      facts,
    },
  };
}

export interface HardwareSpecsAdapterOptions {
  /** Path to the CSV. */
  file?: string;
  /** Already-read rows, for tests. */
  rows?: HardwareSpecRow[];
  /** Called for every row that cannot become a record, so the operator sees the reason. */
  onIssue?: (issue: HardwareSpecIssue) => void;
}

/**
 * One item per row, identified by device and page: re-importing a corrected row updates it, while the same device
 * read from a second page is a separate record with its own citation.
 */
export function createHardwareSpecsAdapter(opts: HardwareSpecsAdapterOptions = {}): SourceAdapter {
  return {
    source: HARDWARE_SPECS_SOURCE,
    async *fetch({ limit, log }) {
      const rows = opts.rows ?? readHardwareSpecCsv(await readFile(opts.file!, 'utf8'));
      let yielded = 0;
      for (const [i, row] of rows.entries()) {
        if (limit != null && yielded >= limit) break;
        const outcome = normalizeHardwareSpecRow(row, i + 2); // +2: one-based, past the header.
        if ('issue' in outcome) {
          opts.onIssue?.(outcome.issue);
          log?.(`row ${outcome.issue.row} (${outcome.issue.name}): skipped — ${outcome.issue.problem}`);
          continue;
        }
        yielded += 1;
        yield {
          externalId: `${outcome.record.identifier.value}@${row.sourceUrl}`,
          url: row.sourceUrl,
          fetchedAt: new Date(),
          contentType: 'text/csv',
          payload: row,
        } satisfies RawItem;
      }
    },
    normalize(item: RawItem): NormalizedRecord[] {
      const outcome = normalizeHardwareSpecRow(item.payload as HardwareSpecRow);
      if ('issue' in outcome) throw new Error(outcome.issue.problem);
      return [outcome.record];
    },
  };
}
