import { catalog, community, compatQueries, getDb } from '@mutinai/db';
import { COMPUTE_BACKENDS } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { submitBenchmark } from '@/app/actions';
import { Empty, PageHead } from '@/components/ui';
import { searchParam } from '@/lib/format';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Submit a benchmark run' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function BenchmarkFormPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) {
    return (
      <>
        <PageHead eyebrow="Contribute" title="Submit a benchmark run" />
        <Empty><Link href="/signin?returnTo=/contribute/benchmark">Sign in</Link> to submit results.</Empty>
      </>
    );
  }
  const db = getDb();
  const [benchmarks, { artifacts, runtimes }, configurations, ownConfigs, models] = await Promise.all([
    catalog.listBenchmarks(db, 'performance'),
    compatQueries.loadCompatCatalog(db),
    catalog.listConfigurations(db),
    community.listOwnHardwareConfigs(db, session.viewer),
    catalog.listModels(db, { sort: 'name' }),
  ]);
  const benchmarkSlug = searchParam(sp, 'benchmark') ?? benchmarks.find((b) => b.id === searchParam(sp, 'benchmarkId'))?.slug ?? 'llama-bench';
  const benchmark = benchmarks.find((b) => b.slug === benchmarkSlug) ?? benchmarks[0]!;
  const modelSlug = searchParam(sp, 'model');
  const system = searchParam(sp, 'system');
  const choices = artifacts
    .filter((a) => !modelSlug || a.modelSlug === modelSlug)
    .sort((a, b) => a.variantName.localeCompare(b.variantName) || b.bitsPerWeight - a.bitsPerWeight);
  const error = searchParam(sp, 'error');

  return (
    <>
      <PageHead
        eyebrow="Contribute · benchmark"
        title="Submit a benchmark run"
        lede="Record exactly what you ran so others can compare and reproduce it. Runs start unverified; verified public runs feed measured speeds in “What can I run?”."
      />
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <form className="filters" action="/contribute/benchmark">
        <label className="field">
          <span>Benchmark</span>
          <select name="benchmark" defaultValue={benchmark.slug}>
            {benchmarks.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Model (narrows artifacts)</span>
          <select name="model" defaultValue={modelSlug ?? ''}>
            <option value="">All models</option>
            {models.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
          </select>
        </label>
        {system && <input type="hidden" name="system" value={system} />}
        <button className="btn" type="submit">Update form</button>
      </form>

      <form action={submitBenchmark} className="panel panel-pad" style={{ maxWidth: 980 }}>
        <input type="hidden" name="benchmarkId" value={benchmark.id} />
        <fieldset>
          <legend>What ran</legend>
          <div className="form-grid">
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span>Model artifact (variant + quantization)</span>
              <select name="artifactId" required defaultValue={searchParam(sp, 'artifactId') ?? ''}>
                <option value="" disabled>Choose…</option>
                {choices.map((a) => (
                  <option key={a.artifactId} value={a.artifactId}>{a.variantName} — {a.schemeName} ({a.format}, {a.publisherName})</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Runtime</span>
              <select name="runtimeId" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {runtimes.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.formats.join(', ')})</option>)}
              </select>
            </label>
            <label className="field"><span>Runtime version</span><input type="text" name="runtimeVersion" placeholder="e.g. b5450, 0.8.5" /></label>
            <label className="field">
              <span>Backend</span>
              <select name="backend" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {COMPUTE_BACKENDS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Hardware</legend>
          <label className="field">
            <span>System</span>
            <select name="hardware" required defaultValue={system ? `ref:${configurations.find((c) => c.slug === system)?.id}` : ''}>
              <option value="" disabled>Choose…</option>
              {ownConfigs.length > 0 && (
                <optgroup label="My systems">
                  {ownConfigs.map((c) => <option key={c.id} value={`user:${c.id}`}>{c.name} ({c.visibility})</option>)}
                </optgroup>
              )}
              <optgroup label="Reference systems (only if your build matches)">
                {configurations.map((c) => <option key={c.id} value={`ref:${c.id}`}>{c.name}</option>)}
              </optgroup>
            </select>
          </label>
          <p className="field-hint">
            Hardware components of a personal system are shown with public runs; its name stays private unless the system itself is public.{' '}
            <Link href="/me#systems">Add a system</Link>.
          </p>
        </fieldset>

        <fieldset>
          <legend>Settings</legend>
          <div className="form-grid">
            <label className="field"><span>Context length</span><input type="number" name="contextLength" min="0" placeholder="4096" /></label>
            <label className="field"><span>Batch size</span><input type="number" name="batchSize" min="0" /></label>
            <label className="field"><span>GPU layers</span><input type="number" name="gpuLayers" min="0" placeholder="blank = all" /></label>
            <label className="field"><span>KV cache type</span><input type="text" name="kvCacheType" placeholder="f16, q8_0" /></label>
            <label className="field"><span>OS</span><input type="text" name="os" placeholder="Ubuntu 24.04, macOS 15.4" /></label>
            <label className="field"><span>Driver</span><input type="text" name="driverVersion" /></label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" name="flashAttention" /> <span style={{ textTransform: 'none', letterSpacing: 0 }}>Flash attention on</span></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Results — {benchmark.name}</legend>
          <div className="form-grid">
            {benchmark.metrics.map((m) => (
              <label key={m.id} className="field">
                <span>{m.label} ({m.unit})</span>
                <input type="hidden" name="metricId" value={m.id} />
                <input type="number" name={`metric_${m.id}`} min="0" step="any" />
              </label>
            ))}
          </div>
        </fieldset>

        <div className="form-grid">
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Notes</span><input type="text" name="notes" maxLength={2000} placeholder="Power limits, unusual flags, anything that affects results" /></label>
          <label className="field">
            <span>Visibility</span>
            <select name="visibility" defaultValue="public">
              <option value="public">Public</option>
              <option value="unlisted">Unlisted (link only)</option>
              <option value="private">Private (only me)</option>
            </select>
          </label>
        </div>
        <div style={{ marginTop: 14 }}><button className="btn btn-primary" type="submit">Submit run</button></div>
      </form>
    </>
  );
}
