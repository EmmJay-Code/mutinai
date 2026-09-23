import type { compatQueries } from '@mutinai/db';
import Link from 'next/link';
import { formatBytes } from '@/lib/format';

type Rec = compatQueries.CompatRecommendation;

/** The first download in the list that a given app can open, and that has a known repository to point it at. */
const firstFor = (recs: Rec[], formats: string[]) => recs.find((r) => formats.includes(r.row.format) && r.row.sourceRepo && r.result.fit !== 'none');

/**
 * Concrete first-run instructions for one model: the exact thing to search for and the exact command to type.
 * LM Studio first because it needs no terminal; Ollama for people who prefer one. Ollama can pull any GGUF file from
 * Hugging Face by repository and quantization (`ollama run hf.co/<repo>:<quant>`), so the command names the same
 * download the page recommends rather than a registry tag that may be a different file.
 */
export function RunSteps({ variantName, recommended, alternatives }: { variantName: string; recommended: Rec; alternatives: Rec[] }) {
  const all = [recommended, ...alternatives];
  const lmStudio = firstFor(all, ['gguf', 'mlx']);
  const ollama = firstFor(all, ['gguf']);
  if (!lmStudio && !ollama) {
    return (
      <p className="small muted">
        The recommended download runs with <Link className="link" href={`/tools/${recommended.runtime.slug}`}>{recommended.runtime.name}</Link>, which is set up from its own documentation rather than a desktop app.
      </p>
    );
  }
  return (
    <div className="run-steps">
      {lmStudio && (
        <div>
          <h4>Easiest: <Link href="/tools/lm-studio">LM Studio</Link> <span>free desktop app, no terminal</span></h4>
          <ol>
            <li>Download LM Studio from <a className="link" href="https://lmstudio.ai" rel="noopener noreferrer">lmstudio.ai</a>, install it and open it.</li>
            <li>Open the search tab (the magnifying glass) and search for <code>{lmStudio.row.sourceRepo}</code>.</li>
            <li>Choose the <code>{lmStudio.row.schemeName}</code> download{lmStudio.row.sizeBytes ? ` (${formatBytes(lmStudio.row.sizeBytes)})` : ''} and click Download.</li>
            <li>Go to the chat tab, pick {variantName} at the top, and type your first message.</li>
          </ol>
        </div>
      )}
      {ollama && (
        <div>
          <h4>In a terminal: <Link href="/tools/ollama">Ollama</Link> <span>one command</span></h4>
          <ol>
            <li>Install Ollama from <a className="link" href="https://ollama.com/download" rel="noopener noreferrer">ollama.com/download</a>.</li>
            <li>
              Open a terminal and run:
              <pre><code>ollama run hf.co/{ollama.row.sourceRepo}:{ollama.row.schemeName}</code></pre>
              The first run downloads the model{ollama.row.sizeBytes ? ` (${formatBytes(ollama.row.sizeBytes)})` : ''}; then type a message and press Enter.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
