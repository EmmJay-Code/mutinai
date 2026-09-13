# Source notes (researched 2026-09-12/13)

Official documentation was checked for each source, and responses were confirmed with small real requests except
where noted. Re-check limits before raising volumes.

## Hugging Face Hub
- **Endpoints:**
  - `GET /api/models?author=…&sort=lastModified&direction=-1&limit≤1000&expand[]=…` (pagination via
    `link: <…cursor=…>; rel="next"`)
  - `GET /api/models?filter=base_model:<relation>:<repo>` (derivatives)
  - `GET /api/models/{repo}?blobs=true&expand[]=…` (detail with file sizes). `expand[]` *replaces* the default
    fields.
  - Useful fields: `baseModels {relation, models}`, `safetensors {total, parameters}`,
    `gguf {total, architecture, context_length}`, `cardData.license`, `siblings[].size`, `pipeline_tag`,
    `library_name`, `config.model_type/quantization_config`. `config` does *not* contain layer counts.
- **Missing or private repos** return **401**, not 404.
- **Without credentials:** all public metadata, including gated models' metadata, at 500 requests / 5 min
  (`ratelimit: "api";r=…;t=…`).
- **With a free token:** 1,000 / 5 min (PRO 2,500) and private/org repos.
- **Terms:** public content is licensed to users for display; model cards remain under their repository licenses.
- **Stored:** repo id, lineage, license key, pipeline/library, weight file names and sizes, parameter totals.
- **Not stored:** README bodies, chat templates. Downloads and likes are kept as daily metrics only.

## GitHub REST API
- **Endpoints:** `GET /repos/{o}/{r}`, `GET /repos/{o}/{r}/releases?per_page≤100` (Link pagination), `GET /rate_limit`
  (free). Send `X-GitHub-Api-Version: 2022-11-28` and a User-Agent (required).
- **Without credentials:** 60 requests/hour per IP, which covers about 25 repositories per hour at two requests each.
  Unauthenticated 304s still use quota.
- **With a token:** 5,000/hour, and 304 responses to conditional requests are free. A fine-grained token with no
  repository permissions is enough for public data.
- **Terms:** API use is not scraping under the Acceptable Use Policies. Avoid excessive request rates, don't share
  tokens, and don't collect personal data.
- **Stored:** description, homepage, language, license, topics, release tag/title/date/URL and the first line of the
  notes.
- **Not stored:** contributor or personal data, full release notes. Stars, forks and watchers are kept as daily
  metrics.
- **Policy note:** llama.cpp publishes every `b…` build as a pre-release, so it currently produces no release events.

## arXiv
- **Endpoint:** `https://export.arxiv.org/api/query?search_query=…&sortBy=lastUpdatedDate&sortOrder=descending&start=…&max_results≤2000`.
  Returns Atom (`opensearch:totalResults`, `id` `http://arxiv.org/abs/<id>v<n>`, `published` for v1, `updated` for
  the returned version). Errors come back as an entry titled `Error`.
- **Throttling:** a plain-text "Rate exceeded." body with HTTP 429. This happened during development, so tests use
  synthetic Atom built from the documented schema.
- **Terms:** at most one request every 3 seconds, one connection. Metadata, abstracts included, is CC0. Link to
  abstracts; don't host PDFs. Suggested acknowledgement: "Thank you to arXiv for use of its open access
  interoperability."
- **Stored:** id, version, title, up to 20 authors, categories, dates, a 240-character abstract excerpt.

## RSS / Atom feeds
- **Verified official feeds:** Hugging Face blog, Qwen blog, Mistral news (served as `text/plain`, valid RSS), Ollama
  and vLLM `releases.atom`. Also available but not enabled: Google DeepMind, Google AI, Google Research, PyTorch,
  NVIDIA developer blog (all broad). Meta AI has no official feed.
- **Practice:** conditional GET; dedupe by guid/Atom id; parse RFC 822 and RFC 3339 dates; don't trust Content-Type.
  The Hugging Face blog feed carries its whole history (861 entries), so each feed is capped at its 20 newest entries.
- **Stored:** feed key, entry id, title, canonical URL (tracking parameters removed), author, categories, dates, a
  280-character plain-text excerpt. Articles are never republished.
