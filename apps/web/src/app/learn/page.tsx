import { catalog, getDb } from '@mutinai/db';
import { licenseOpenness, OPENNESS_TEXT, type LicenseOpenness } from '@mutinai/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EdSection, Masthead, StartStrip } from '@/components/editorial';
import { Explain } from '@/components/ui';
import { LinearBar } from '@/components/viz';
import { formatBytes, formatDate, formatParams, humanize, VARIANT_KIND_EXPLAINER } from '@/lib/format';
import { BACKEND_LABEL } from '@/lib/hardware';

export const metadata: Metadata = { title: 'Learn' };

/**
 * The guides teach with the catalog's own rows rather than with drawn examples: the licence split is counted from the
 * models actually tracked, the download sizes are the real files, and the naming ladder walks a model that exists.
 * Every example is chosen by the data, never named in code, so a guide can neither go stale nor point at something
 * that was removed — and a reader who doubts a figure can click straight through to the record behind it.
 */

const PATHS = [
  {
    id: 'start-here',
    title: 'Start here',
    lede: 'Open models are AI models whose weights you can download, inspect and run yourself.',
    body: [
      'A model’s “weights” are the billions of numbers learned during training. When a lab publishes them, anyone can run the model on their own hardware — no account, no per-token bill, and your data never leaves your machine.',
      '“Open” covers a range. Some models use permissive licenses like Apache 2.0 or MIT; others allow broad use but restrict certain commercial cases. Mutinai always shows the license so you can tell the difference.',
      'The ecosystem moves quickly: a handful of labs release new families every few months, and a much larger community quantizes, fine-tunes, benchmarks and builds tools around them.',
    ],
    next: [
      { href: '/new', label: 'See what’s been released recently' },
      { href: '/models?commercial=allowed', label: 'Browse permissively licensed models' },
    ],
  },
  {
    id: 'run-locally',
    title: 'Run locally',
    lede: 'Three things decide what you can run: memory, quantization and the runtime.',
    body: [
      'Memory is the hard limit. The whole model has to fit in your GPU’s memory (or your Mac’s unified memory) along with a working cache that grows with the length of the conversation. If it doesn’t fit, some runtimes can spill into system RAM — it works, but slowly.',
      'Speed is mostly about how fast memory can be read. That’s why a GPU with fast memory generates text quicker than a CPU with lots of slower RAM — and why mixture-of-experts models, which read only part of their weights per token, feel fast for their size.',
      'Runtimes load the model and serve it: llama.cpp and Ollama run almost anywhere, MLX is built for Apple silicon, and vLLM is designed for serving many users on NVIDIA or AMD GPUs.',
    ],
    next: [
      { href: '/run', label: 'Check what your hardware can run' },
      { href: '/tools?category=runtime', label: 'Compare runtimes' },
      { href: '/hardware?memory=unified', label: 'Look at unified-memory machines' },
    ],
  },
  {
    id: 'understand-models',
    title: 'Understand models',
    lede: 'The names look chaotic, but they encode a simple structure.',
    body: [
      'Read a name from the outside in and it comes apart into five levels. Anyone can add to the lower ones: a quantization, a fine-tune or a distill is often published by someone other than the lab that trained the model, which is exactly what open weights make possible.',
      'Benchmarks give a rough sense of capability. Most scores are reported by the model’s developer with their own prompts and settings; a few benchmarks run every model themselves with one setup. Use them to shortlist, then look at community results and reviews from people doing what you want to do.',
      'Mutinai labels every number with where it came from: developer-reported, run by the benchmark itself, measured by the community, or estimated.',
    ],
    next: [
      { href: '/models/qwen2-5-32b', label: 'Explore a model with several variants' },
      { href: '/models/compare?m=qwen3-30b-a3b&m=qwen2-5-32b', label: 'Compare a dense model with a mixture-of-experts model' },
    ],
  },
  {
    id: 'build',
    title: 'Build with them',
    lede: 'Most tools speak the same API, so switching models is usually a configuration change.',
    body: [
      'Runtimes like Ollama, llama.cpp’s server and vLLM expose an OpenAI-compatible API. Chat interfaces, coding assistants and agent frameworks can point at them directly — or through a gateway that routes between local and hosted models.',
      'Coding assistants such as Aider and Continue work well with code-specialised models. For agents, look for strong tool-use results and reviews that mention reliability over long tasks.',
      'When a model is close but not quite right, fine-tuning frameworks adapt it to your data on a single GPU. Keep the result’s license — inherited from the base model — in mind.',
    ],
    next: [
      { href: '/tools?category=coding_assistant', label: 'Coding assistants' },
      { href: '/models?capability=tool_use', label: 'Models with tool use' },
      { href: '/tools?category=fine_tuning', label: 'Fine-tuning tools' },
    ],
  },
];

export default async function LearnPage() {
  const db = getDb();
  const [models, runtimes] = await Promise.all([catalog.listModels(db), catalog.listProjects(db, { category: 'runtime' })]);
  // The worked example is whichever model has the most downloads on file: the one whose ladder and size range are
  // fullest. Picked from data, so nothing here names a model that might later be removed.
  const richest = [...models].sort((a, b) => b.artifactCount - a.artifactCount || b.variantCount - a.variantCount)[0];
  const example = richest ? await catalog.getModelDetail(db, richest.slug) : null;

  const figures: Record<string, React.ReactNode> = {
    'start-here': <LicenceFigure models={models} />,
    'run-locally': example ? <SizeFigure model={example} /> : null,
    'understand-models': example ? <LadderFigure model={example} /> : null,
    build: <RuntimeFigure runtimes={runtimes} />,
  };

  return (
    <>
      <Masthead
        eyebrow="Learn"
        title="Open models, explained as you go."
        lede="Four short paths: just enough to make sense of what you’re looking at, then straight to the real data. Every figure is counted from the catalog, so you can click any of it to see where it came from."
      >
        <StartStrip label="Four paths" items={PATHS.map((p, i) => ({ href: `#${p.id}`, tag: `Path ${i + 1}`, name: p.title, why: p.lede }))} />
      </Masthead>
      {PATHS.map((p) => (
        <EdSection key={p.id} id={p.id} title={p.title} intro={p.lede}>
          <div className="split-wide">
            <div className="prose">
              {figures[p.id]}
              {p.body.map((para, j) => <p key={j}>{para}</p>)}
            </div>
            <aside>
              <div className="surface">
                <div className="subhead" style={{ marginTop: 0 }}>Go deeper</div>
                <ul className="list-plain">
                  {p.next.map((n) => <li key={n.href}><Link href={n.href}>{n.label} →</Link></li>)}
                </ul>
              </div>
            </aside>
          </div>
        </EdSection>
      ))}
    </>
  );
}

/** Downloadable weights are the entry price; the licence is what differs. Counted across the catalog, never asserted. */
function LicenceFigure({ models }: { models: catalog.ModelListItemDTO[] }) {
  const order: LicenseOpenness[] = ['permissive', 'restricted', 'noncommercial', 'unknown'];
  const counts = models.reduce<Record<string, number>>((acc, m) => {
    const key = licenseOpenness(m.licenses);
    return { ...acc, [key]: (acc[key] ?? 0) + 1 };
  }, {});
  const shown = order.filter((k) => counts[k]);
  if (!models.length) return null;
  return (
    <figure className="learn-figure">
      <div className={`licence-bar t-${shown.length === 1 ? 'one' : 'many'}`} role="img" aria-label={shown.map((k) => `${counts[k]} ${OPENNESS_TEXT[k].label}`).join(', ')}>
        {shown.map((k) => <span key={k} className={`seg seg-${k}`} style={{ flexGrow: counts[k] }} />)}
      </div>
      <ul className="licence-key">
        {shown.map((k) => (
          <li key={k}>
            <span className={`dot seg-${k}`} aria-hidden="true" />
            <b className="num">{counts[k]}</b>
            <span>{OPENNESS_TEXT[k].label}<span className="sub">{OPENNESS_TEXT[k].detail}</span></span>
          </li>
        ))}
      </ul>
      <figcaption>
        All {models.length} models tracked here publish their weights. What differs is the licence on them — which is the part the word “open” does not tell you.
      </figcaption>
    </figure>
  );
}

/** The same model as published at several precisions. The sizes are the real files, so the trade-off is visible. */
function SizeFigure({ model }: { model: catalog.ModelDetailDTO }) {
  const byScheme = new Map<string, { name: string; bits: number; bytes: number; slug: string; modelSlug: string }>();
  for (const v of model.variants) {
    for (const a of v.artifacts) {
      if (a.sizeBytes == null) continue;
      const seen = byScheme.get(a.schemeName);
      if (!seen || a.sizeBytes > seen.bytes) byScheme.set(a.schemeName, { name: a.schemeName, bits: a.bitsPerWeight, bytes: a.sizeBytes, slug: a.slug, modelSlug: model.slug });
    }
  }
  const sizes = [...byScheme.values()].sort((a, b) => b.bytes - a.bytes);
  if (sizes.length < 2) return null;
  const largest = sizes[0]!;
  const smallest = sizes[sizes.length - 1]!;
  const share = Math.round((smallest.bytes / largest.bytes) * 100);
  return (
    <figure className="learn-figure">
      <div className="fig-head">
        <h3><Link href={`/models/${model.slug}`}>{model.name}</Link>, as published</h3>
        <span className="small muted">{sizes.length} precisions on file</span>
      </div>
      <div className="size-bars">
        {sizes.map((s) => (
          <LinearBar key={s.name} value={s.bytes} max={largest.bytes} label={`${s.name} · ${s.bits}-bit`} display={formatBytes(s.bytes)} color={s === smallest ? 'var(--accent)' : undefined} />
        ))}
      </div>
      <figcaption>
        One model, {sizes.length} downloads — <Explain term="quantization" /> stores each weight in fewer bits, so {smallest.name} is {share}% the size of {largest.name}.
        The file has to fit in memory with room left over for the conversation, which is why the 4-bit downloads are the usual choice.{' '}
        <Link className="link" href={`/run`}>See what fits your machine →</Link>
      </figcaption>
    </figure>
  );
}

/** Five levels of one real name, outside in. The rung a reader is stuck on is usually variant or quantization. */
function LadderFigure({ model }: { model: catalog.ModelDetailDTO }) {
  const instruct = model.variants.find((v) => v.kind === 'instruct') ?? model.variants[0];
  const thirdParty = model.variants.find((v) => v.publisher.slug !== model.developer.slug);
  const download = instruct?.artifacts.find((a) => a.bitsPerWeight <= 5) ?? instruct?.artifacts[0];
  const rungs = [
    { level: 'Family', name: model.family.name, href: `/models?family=${model.family.slug}`, what: `A lineage from one developer — ${model.developer.name}.` },
    { level: 'Release', name: model.release.name, href: `/models?family=${model.family.slug}`, what: model.release.releasedOn ? `A dated generation within it, published ${formatDate(model.release.releasedOn)}.` : 'A generation within it.' },
    { level: 'Model', name: model.name, href: `/models/${model.slug}`, what: `One trained size: ${formatParams(model.paramsTotal)} parameters.` },
    instruct && { level: 'Variant', name: instruct.name, href: `/models/${model.slug}#${instruct.slug}`, what: VARIANT_KIND_EXPLAINER[instruct.kind] ?? `A ${humanize(instruct.kind)} version of those weights.` },
    download && { level: 'Download', name: download.schemeName, href: `/models/${model.slug}#${instruct?.slug ?? ''}`, what: `One file at one precision — ${formatBytes(download.sizeBytes)}, published by ${download.publisher.name}.` },
  ].filter(Boolean) as { level: string; name: string; href: string; what: string }[];

  return (
    <figure className="learn-figure">
      <ol className="ladder">
        {rungs.map((r, i) => (
          <li key={r.level} style={{ marginLeft: i * 14 }}>
            <span className="rung-level">{r.level}</span>
            <Link className="rung-name" href={r.href}>{r.name}</Link>
            <span className="rung-what">{r.what}</span>
          </li>
        ))}
      </ol>
      <figcaption>
        {thirdParty
          ? <>Each level narrows the one above it. The lower two are open to anyone: {thirdParty.name} is a {humanize(thirdParty.kind)} of this model published by {thirdParty.publisher.name}, not by {model.developer.name}.</>
          : <>Each level narrows the one above it. The lower two are open to anyone — quantizations and fine-tunes are often published by people other than the original lab.</>}
      </figcaption>
    </figure>
  );
}

/** Which program reads which file, and what it runs on. The pairing is the thing beginners get wrong. */
function RuntimeFigure({ runtimes }: { runtimes: catalog.ProjectDTO[] }) {
  const rows = runtimes.filter((r) => r.runtime);
  if (!rows.length) return null;
  return (
    <figure className="learn-figure">
      <div className="runtime-grid">
        <div className="rg-head" aria-hidden="true"><span>Runtime</span><span>Reads</span><span>Runs on</span><span>API</span></div>
        {rows.map((r) => (
          <div className="rg-row" key={r.slug}>
            <Link href={`/tools/${r.slug}`}>{r.name}</Link>
            <span className="mono">{r.runtime!.formats.join(', ')}</span>
            <span className="small">{r.runtime!.backends.map((b) => BACKEND_LABEL[b] ?? b).join(', ')}</span>
            <span className="small muted">{r.runtime!.openaiCompatibleApi ? 'OpenAI-compatible' : '—'}</span>
          </div>
        ))}
      </div>
      <figcaption>
        A download only runs on a runtime that reads its format — a <span className="mono">gguf</span> file needs llama.cpp or Ollama, an <span className="mono">mlx</span> file needs Apple silicon. Where the API column says OpenAI-compatible, anything built for that API can point at it unchanged.
      </figcaption>
    </figure>
  );
}
