import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guards the deployed shape of render.yaml: what the cron job ingests, and where credentials may live.
const blueprint = readFileSync(new URL('../../../render.yaml', import.meta.url), 'utf8');
const services = blueprint.split(/^ {2}- type: /m).slice(1);
const service = (name: string) => {
  const block = services.find((s) => new RegExp(`^ {4}name: ${name}$`, 'm').test(s));
  if (!block) throw new Error(`render.yaml has no service ${name}`);
  return block;
};
/** The lines of one env var entry, from `- key: NAME` to the next entry. */
const envVar = (block: string, key: string) => block.match(new RegExp(`^ {6}- key: ${key}\\n((?: {8}.*\\n?)*)`, 'm'))?.[1];

describe('render.yaml', () => {
  it('has one database, the web service and the ingestion cron job, and no resident worker', () => {
    expect(blueprint.match(/^ {2}- name: /gm)).toHaveLength(1);
    expect(services.map((s) => s.split('\n')[0])).toEqual(['web', 'cron']);
  });

  it('schedules exactly huggingface, github and feeds every 6 hours into the preview database', () => {
    const cron = service('mutinai-ingest');
    expect(cron).toMatch(/^ {4}schedule: "15 \*\/6 \* \* \*"$/m);
    expect(cron).toMatch(/^ {4}startCommand: npm run ingest:scheduled$/m);
    expect(cron).toMatch(/^ {4}region: virginia$/m);
    expect(envVar(cron, 'MUTINAI_LIVE_SOURCES')).toBe('        value: huggingface,github,feeds\n');
    expect(envVar(cron, 'MUTINAI_INGEST_LIMIT')).toBe('        value: "300"\n');
    expect(envVar(cron, 'DATABASE_URL')).toMatch(/name: mutinai-db\n {10}property: connectionString/);
  });

  it('keeps source tokens on the cron job only, never with a committed value', () => {
    const cron = service('mutinai-ingest');
    for (const key of ['GITHUB_TOKEN', 'HUGGINGFACE_TOKEN']) {
      expect(envVar(cron, key)).toBe('        sync: false\n');
      expect(service('mutinai-web')).not.toContain(key);
    }
    expect(service('mutinai-web')).not.toContain('MUTINAI_LIVE_SOURCES');
  });

  it('keeps the public preview non-indexed and in production mode', () => {
    const web = service('mutinai-web');
    expect(envVar(web, 'NODE_ENV')).toBe('        value: production\n');
    expect(envVar(web, 'MUTINAI_ALLOW_INDEXING')).toBe('        value: "0"\n');
  });
});
