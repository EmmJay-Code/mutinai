import { HttpClient } from '../../src/http';

/**
 * SYNTHETIC arXiv API responses built from the documented Atom schema (info.arxiv.org/help/api/user-manual.html).
 * Real responses could not be recorded: export.arxiv.org rate-limited the recording machine (HTTP 429). The papers
 * below are invented and exist only to exercise parsing and pipeline behaviour.
 */
export interface SyntheticPaper {
  id: string;
  version?: number;
  title: string;
  summary?: string;
  authors?: string[];
  published: string;
  updated?: string;
  categories?: string[];
}

export function arxivAtom(papers: SyntheticPaper[], totalResults = papers.length): string {
  const entries = papers
    .map(
      (p) => `  <entry>
    <id>http://arxiv.org/abs/${p.id}v${p.version ?? 1}</id>
    <updated>${p.updated ?? p.published}</updated>
    <published>${p.published}</published>
    <title>${p.title}</title>
    <summary>  ${p.summary ?? 'An abstract.'}
    </summary>
${(p.authors ?? ['A. Author']).map((a) => `    <author><name>${a}</name></author>`).join('\n')}
    <link href="http://arxiv.org/abs/${p.id}v${p.version ?? 1}" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/${p.id}v${p.version ?? 1}" rel="related" type="application/pdf"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="${(p.categories ?? ['cs.CL'])[0]}" scheme="http://arxiv.org/schemas/atom"/>
${(p.categories ?? ['cs.CL']).map((c) => `    <category term="${c}" scheme="http://arxiv.org/schemas/atom"/>`).join('\n')}
  </entry>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link href="http://arxiv.org/api/query" rel="self" type="application/atom+xml"/>
  <title type="html">ArXiv Query</title>
  <id>http://arxiv.org/api/synthetic</id>
  <updated>2026-09-13T00:00:00-04:00</updated>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">${totalResults}</opensearch:totalResults>
  <opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex>
  <opensearch:itemsPerPage xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">${papers.length}</opensearch:itemsPerPage>
${entries}
</feed>
`;
}

export const ARXIV_ERROR_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query</title>
  <id>http://arxiv.org/api/errors</id>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/api/errors#incorrect_id_format_for_1234.1234</id>
    <title>Error</title>
    <summary>incorrect id format for 1234.1234</summary>
    <updated>2026-09-13T00:00:00-04:00</updated>
  </entry>
</feed>
`;

/** Serves pages by the `start` parameter; records requested URLs. */
export function offlineArxiv(pages: (string | { status: number; body: string })[]) {
  const requested: URL[] = [];
  const fetch = (async (input: string) => {
    const url = new URL(input);
    requested.push(url);
    const index = Math.floor(Number(url.searchParams.get('start') ?? 0) / 50);
    const page = pages[index] ?? arxivAtom([], 0);
    if (typeof page !== 'string') return new Response(page.body, { status: page.status, headers: { 'content-type': 'text/plain' } });
    return new Response(page, { status: 200, headers: { 'content-type': 'application/atom+xml' } });
  }) as unknown as typeof globalThis.fetch;
  return { client: new HttpClient({ fetch, sleep: async () => {}, maxRetries: 1 }), requested };
}
