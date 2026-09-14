import { describe, expect, it } from 'vitest';
import { normalizeHardwareSpecRow, parseCsv, readHardwareSpecCsv, type HardwareSpecRow } from '../../src/adapters/hardware-specs';

const row = (over: Partial<HardwareSpecRow> = {}): HardwareSpecRow => ({
  name: 'GeForce RTX 5080',
  manufacturer: 'NVIDIA',
  memoryGb: '16',
  sourceUrl: 'https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5080/',
  ...over,
});

const recordOf = (r: HardwareSpecRow) => {
  const outcome = normalizeHardwareSpecRow(r);
  if ('issue' in outcome) throw new Error(`expected a record, got: ${outcome.issue.problem}`);
  return outcome.record;
};
const problemOf = (r: HardwareSpecRow) => {
  const outcome = normalizeHardwareSpecRow(r);
  if ('record' in outcome) throw new Error('expected the row to be refused');
  return outcome.issue.problem;
};

describe('reading the file', () => {
  it('matches headers however they are spelled, and keeps blanks blank', () => {
    const rows = readHardwareSpecCsv(
      'Full Name,Manufacturer,Memory GB,Memory Type,Bandwidth GB/s,TDP Watts,Release Date,Launch Price USD,Source URL\n' +
      'GeForce RTX 4090,NVIDIA,24,GDDR6X,,450,,,https://example.com/4090\n',
    );
    expect(rows).toEqual([{
      slug: undefined, name: 'GeForce RTX 4090', manufacturer: 'NVIDIA', deviceKind: undefined, memoryKind: undefined, backends: undefined,
      memoryGb: '24', memoryType: 'GDDR6X', bandwidthGbps: undefined, tdpWatts: '450', releaseDate: undefined, launchPriceUsd: undefined,
      sourceUrl: 'https://example.com/4090',
    }]);
  });

  it('reads quoted fields, escaped quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x,1","he said ""hi"""\r\n')).toEqual([['a', 'b'], ['x,1', 'he said "hi"']]);
  });

  it('refuses a file without the columns that make a row meaningful', () => {
    expect(() => readHardwareSpecCsv('Full Name,Memory GB\nRTX 4090,24\n')).toThrow(/missing required column\(s\): manufacturer, sourceUrl/);
  });
});

describe('a value without a page is not a fact', () => {
  it('refuses a row with no source URL, or one that is not a URL', () => {
    expect(problemOf(row({ sourceUrl: '' }))).toMatch(/no source URL/);
    expect(problemOf(row({ sourceUrl: 'nvidia spec page' }))).toMatch(/not a URL/);
  });

  it('cites the page on the record, so provenance follows the row', () => {
    expect(recordOf(row()).identifier).toMatchObject({ namespace: 'editorial-hardware', value: 'geforce-rtx-5080', url: expect.stringContaining('nvidia.com') });
  });
});

describe('a blank is a blank', () => {
  it('states only the fields the page gave, and never invents the rest', () => {
    const record = recordOf(row({ memoryGb: '16', memoryType: 'GDDR7', bandwidthGbps: '', tdpWatts: '360', releaseDate: '', launchPriceUsd: '' }));
    expect(record.facts).toEqual([
      { field: 'memoryGb', value: 16 },
      { field: 'tdpWatts', value: 360 },
      { field: 'memoryType', value: 'GDDR7' },
    ]);
  });

  it('refuses a row that states nothing at all rather than creating an empty device', () => {
    expect(problemOf({ name: 'Mystery card', manufacturer: 'NVIDIA', sourceUrl: 'https://example.com/x' })).toMatch(/no specifications stated/);
  });
});

describe('numbers and dates are read, never coerced', () => {
  it('accepts the shapes people actually paste', () => {
    const record = recordOf(row({ memoryGb: '24 GB', bandwidthGbps: '1,008', tdpWatts: '450W', launchPriceUsd: '$1,599', releaseDate: '12/13/2022' }));
    expect(Object.fromEntries(record.facts.map((f) => [f.field, f.value]))).toMatchObject({
      memoryGb: 24, memoryBandwidthGbps: 1008, tdpWatts: 450, launchPriceUsd: 1599, releasedOn: '2022-12-13',
    });
  });

  it('refuses text where a number belongs instead of guessing zero', () => {
    expect(problemOf(row({ bandwidthGbps: 'not listed' }))).toMatch(/is not a number/);
    expect(problemOf(row({ tdpWatts: 'about 300' }))).toMatch(/is not a number/);
  });

  it('refuses a slipped decimal or a pasted wrong column', () => {
    expect(problemOf(row({ memoryGb: '24000' }))).toMatch(/outside the plausible range/);
    expect(problemOf(row({ launchPriceUsd: '0' }))).toMatch(/outside the plausible range/);
  });

  it('refuses dates it cannot read unambiguously, and dates that are not launches', () => {
    expect(problemOf(row({ releaseDate: 'Q4 2022' }))).toMatch(/is not an ISO/);
    expect(problemOf(row({ releaseDate: '2022-02-30' }))).toMatch(/is not an ISO/);
    expect(problemOf(row({ releaseDate: '1970-01-01' }))).toMatch(/not a plausible launch date/);
  });
});

describe('classification is the editor’s, not the pipeline’s', () => {
  it('is optional: a row without it can still update a device that already exists', () => {
    expect(recordOf(row()).classification).toBeUndefined();
  });

  it('is carried through when the file states it', () => {
    expect(recordOf(row({ deviceKind: 'gpu', memoryKind: 'dedicated', backends: 'cuda, vulkan' })).classification)
      .toEqual({ deviceKind: 'gpu', memoryKind: 'dedicated', backends: ['cuda', 'vulkan'] });
  });

  it('holds the ontology’s memory rule before anything reaches the database', () => {
    expect(problemOf(row({ deviceKind: 'gpu', memoryKind: 'dedicated', backends: 'cuda', memoryGb: '', tdpWatts: '360' })))
      .toMatch(/dedicated, so the page must also state memory size/);
    expect(problemOf(row({ deviceKind: 'soc', memoryKind: 'unified', backends: 'metal', memoryGb: '128' })))
      .toMatch(/memory size belongs to the system/);
  });

  it('refuses a partial or invented classification', () => {
    expect(problemOf(row({ deviceKind: 'gpu' }))).toMatch(/memoryKind must be one of/);
    expect(problemOf(row({ deviceKind: 'graphics card', memoryKind: 'dedicated', backends: 'cuda' }))).toMatch(/deviceKind must be one of/);
    expect(problemOf(row({ deviceKind: 'gpu', memoryKind: 'dedicated', backends: 'directx' }))).toMatch(/backends must be from/);
  });
});
