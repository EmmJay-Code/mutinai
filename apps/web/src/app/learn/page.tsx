import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Learn' };

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
      'Quantization shrinks models by storing each weight with fewer bits. A 4-bit version (such as Q4_K_M) needs roughly a third of the memory of the original with a small quality cost, which is why it’s the usual download.',
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
      'A family (Qwen, Llama, Gemma) is a lineage from one developer. A release (Qwen2.5) is a dated generation within it. A model is one trained size — Qwen2.5 32B. A variant is a specific set of weights built from that model: the base, an instruct version for chat, a coder, or a distill made by someone else. Finally, a quantization is a downloadable file of a variant at a particular precision.',
      'Benchmarks give a rough sense of capability, but developers report them with different prompts and settings. Use them to shortlist, then look at community results and reviews from people doing what you want to do.',
      'Mutinai labels every number with where it came from: developer-reported, measured by the community, or estimated.',
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

export default function LearnPage() {
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Learn</div>
        <h1>Open AI, explained as you go.</h1>
        <p className="lede">Four short paths. Each explains just enough to make sense of what you’re looking at, then points you to the real data.</p>
      </div>
      <ol className="paths cols-4" aria-label="Guides">
        {PATHS.map((p) => (
          <li key={p.id}><a href={`#${p.id}`}><strong>{p.title}</strong><span>{p.lede}</span></a></li>
        ))}
      </ol>
      {PATHS.map((p, i) => (
        <section key={p.id} id={p.id} className="entity-section" aria-labelledby={`${p.id}-h`}>
          <div className="split-wide">
            <div className="prose">
              <div className="step">Path 0{i + 1}</div>
              <h2 id={`${p.id}-h`} style={{ fontSize: 'clamp(28px, 3.5vw, 40px)' }}>{p.title}</h2>
              <p className="lede" style={{ margin: 'var(--s3) 0 var(--s5)' }}>{p.lede}</p>
              {p.body.map((para, j) => <p key={j}>{para}</p>)}
            </div>
            <aside>
              <div className="subhead" style={{ marginTop: 0 }}>Go deeper</div>
              <ul className="list-plain">
                {p.next.map((n) => <li key={n.href}><Link href={n.href}>{n.label} →</Link></li>)}
              </ul>
            </aside>
          </div>
        </section>
      ))}
    </>
  );
}
