# Independent benchmark sources: findings (researched 2026-09-17)

Four candidate layer-2 sources were inspected against the gate in [benchmarks.md](./benchmarks.md): reuse must
actually be permitted, and the evaluation must be described well enough to compare. No adapter and no migration was
written.

**What could not be checked.** `huggingface.co` is blocked by this session's network egress policy, so any claim that
depends on a Hugging Face dataset card, Space file or its declared licence is marked *unverified* below rather than
guessed. `livebench.ai`, `swebench.com`, `gorilla.cs.berkeley.edu` and `aider.chat` were also unreachable; everything
below was read from GitHub, which was reachable. Each unverified item names exactly what to re-check from a machine
with open egress.

## 1. Source-by-source findings

| | **LiveBench** | **SWE-bench** | **Aider Polyglot** | **BFCL** |
| --- | --- | --- | --- | --- |
| **Official data source** | `github.com/LiveBench/new-livebench`, `public/table_<release>.csv` (harness: `github.com/LiveBench/LiveBench`) | `github.com/SWE-bench/experiments`, `evaluation/<split>/<entry>/` (harness: `SWE-bench/SWE-bench`) | `github.com/Aider-AI/aider`, `aider/website/_data/polyglot_leaderboard.yml` | `huggingface.co/spaces/gorilla-llm/berkeley-function-calling-leaderboard`, `data.csv` (harness: `ShishirPatil/gorilla`) |
| **Structured data?** | Yes — CSV, one row per model, one column per subtask | Partly — `metadata.yaml` + `results/results.json`, one directory per submission. **No score field**: the number is `len(resolved) / split size`, computed by the reader | Yes — YAML, one record per run | Yes — CSV (generator verified in repo; **published file unverified**, HF blocked) |
| **Licence on the results** | **Unresolved.** `LiveBench/LiveBench` is Apache 2.0 (FastChat + LiveCodeBench notices) and `docs/DATASHEET.md` says the benchmark suite is "distributed under the Apache License 2.0", "no copyrights on the data", "no fees or restrictions". But `new-livebench`, which holds the score CSVs, **has no LICENSE file** | **Unresolved.** `SWE-bench/SWE-bench` is MIT, but `SWE-bench/experiments`, which holds the leaderboard entries, **has no LICENSE file** and its README makes no licence, terms or copyright statement. Entries are third-party submissions | **Apache 2.0.** `LICENSE.txt` at the repo root, no carve-out for `website/_data`. (The *exercises* are Exercism's, but those are task inputs, not results) | **Apache 2.0, explicit.** README: "All the leaderboard statistics, and data used to train the models are released under Apache 2.0" — the only one of the four that names the statistics |
| **Attribution required** | Apache 2.0 notice + paper citation (BibTeX in README) | Unresolved; the SWE-bench paper citation is the customary form | Apache 2.0 notice; credit Aider | Apache 2.0 notice; README gives a Gorilla paper citation but **no BFCL-specific BibTeX** |
| **Redistribution on Mutinai** | **Unresolved** — see licence row | **No / unresolved** — do not ingest | **Permitted** | **Permitted** |
| **Fields per result** | `model` + 22 subtask columns, raw 0–100. Categories from `categories_<release>.json` (7 categories). Optional `cost_<release>.csv`: per-subtask total cost, `nq_<subtask>` question counts, `avg_input_tokens`, `avg_output_tokens`, `input_price_per_million`, `output_price_per_million` | `metadata.yaml`: `info.name/site/logo`, `tags.model[]`, `tags.org`, `tags.agent`, `tags.agent_org`, `tags.model_org`, `tags.model_display`, `tags.os_model`, `tags.os_system`, `tags.system.attempts`, `tags.checked`, `assets.logs/trajs`. `results/`: `results.json` (`resolved[]`, `no_generation[]`, `no_logs[]`), `resolved_by_repo.json`, `resolved_by_time.json` | 30 keys per run, including `model`, `edit_format`, `editor_model`, `editor_edit_format`, `reasoning_effort`, `pass_rate_1/2`, `pass_num_1/2`, `test_cases`, `total_tests`, `percent_cases_well_formed`, `num_malformed_responses`, `exhausted_context_windows`, `test_timeouts`, `syntax_errors`, `prompt_tokens`, `completion_tokens`, `thinking_tokens`, `total_cost`, `seconds_per_case`, `command`, `commit_hash`, `versions`, `date`, `dirname` | 37 columns (`COLUMNS_OVERALL`): `Rank`, `Overall Acc`, `Model`, `Model Link`, `Total Cost ($)`, `Latency Mean/Std/95th`, then per-category accuracies (Non-Live AST, Live, Multi Turn, Web Search, Memory), `Relevance`/`Irrelevance Detection`, `Format Sensitivity Max Delta`/`Standard Deviation`, `Organization`, `License` |
| **Model identifier** | Runner string, e.g. `claude-opus-4-5-20251101-thinking-64k-high-effort`. **`src/Table/modelLinks.js` maps each to `organization`, `displayName`, `version`, `reasoner`, `openweight: true`, and often an explicit `huggingface:` URL** | Vendor API names in `tags.model[]` (e.g. `claude-4-sonnet-20250514`), plus `os_model` / `os_system` booleans. No HF ids | Free-text display names: `"Qwen3 235B A22B diff, no think, Alibaba API"`, `"DeepSeek R1 (0528)"`. No HF ids, no open/closed flag | **Hugging Face repo ids** for open models: `meta-llama/Llama-3.1-8B-Instruct`, `google/gemma-3-27b-it`, with a `-FC` key suffix for function-calling mode. `ModelConfig` also carries `org`, `license`, `url`, `input_price`, `output_price`, `is_fc_model` |
| **Benchmark/task id** | Subtask column name (`code_generation`, `zebra_puzzle`, …) inside a release date | Split (`lite`, `verified`, `multimodal`, `multilingual`, `test`) | The polyglot suite as a whole; 225 exercises across 6 languages | Category column name; V1–V4 versions |
| **Score format** | Float 0–100 per subtask. Category and overall averages are **computed in the browser and never stored** | Derived: resolved count ÷ split size. Also per-repo and per-year breakdowns | `pass_rate_2` percent (after 2 attempts) plus `pass_num_2` / `test_cases` counts; `pass_rate_1` is the first attempt | Accuracy 0–1 per column |
| **Date / version** | Release folder date (`2026_06_25`); 11 releases from `2024_06_24` | Submission folder `YYYYMMDD_<system>_<model>`; git history | `date` (run date), `versions` (aider version, e.g. `0.75.2.dev`), `commit_hash` | BFCL version (V1–V4); no per-row date in the columns |
| **Harness version** | Aider-style version not recorded in the CSV; the release date pins the question set | Agent + scaffold named in `tags`; its version is in the entry folder name (e.g. `mini-v2.4.6`) | **Yes — `versions` and `commit_hash`**, the best of the four | BFCL version only |
| **Prompt / few-shot / config** | Configuration is baked into the model string (`-thinking-64k-high-effort`) rather than recorded in fields | `tags.system.attempts` (e.g. 1); the scaffold's prompting lives in the submitter's repo | **`edit_format`, `editor_model`, `editor_edit_format`, `reasoning_effort`, `command`** — the full invocation | `is_fc_model` (function-calling vs prompt mode); `Format Sensitivity` columns measure prompt-format variance |
| **Hardware / runtime** | None | None | None | None (API and local models both run; hardware not recorded) |
| **Sample count / uncertainty** | Question counts only in the optional cost file (`nq_<subtask>`). **No stderr** | `len(resolved)` and the split size give an exact numerator/denominator. No stderr | **`pass_num_1/2` and `test_cases`/`total_tests`** — exact numerator and denominator. No stderr | `Latency Mean / Std / 95th` and `Format Sensitivity Standard Deviation` — but these are about latency and prompt sensitivity, **not** score uncertainty. No score stderr |
| **History kept** | **Yes** — every release's CSV stays in `public/` | **Yes** — every submission directory stays; artifacts moved to submitters' own repos mid-2026, older ones point at `s3://swe-bench-submissions/` | **Yes** — git history of one file | Unverified (HF Space commit history exists) |
| **Change frequency** | **High.** Commits on 2026-09-16, -10, -07, -06, -04, many titled "Board: `<model>` (full 7-category run)"; new question releases roughly quarterly | **Moderate, active.** Latest submissions 2026-09-02/03 | **Stale.** Last change to the leaderboard file: **2025-10-04**, ~11 months ago | **Slowing.** Last commit to the leaderboard directory: **2026-03-23**, ~6 months ago |
| **Fetchable without HTML scraping** | **Yes, verified** — plain CSV/JSON over `raw.githubusercontent.com`, no auth | **Yes, verified** — YAML/JSON over `raw.githubusercontent.com`; directory enumeration needs the GitHub API or the repo cloned | **Yes, verified** — one YAML file | **Unverified** — the file is in a HF Space, unreachable from here. The generator and its columns were verified in the GitHub repo |

### Licence notes, stated conservatively

- **SWE-bench is the clearest "no" of the four.** The benchmark code is MIT, but the leaderboard entries are in a
  separate repository with no licence at all, contributed by third parties who each retain their own rights. Nothing
  grants Mutinai redistribution. Additionally, since 2025-11-18 SWE-bench Verified and Multilingual accept
  submissions only from academic teams and research institutions with peer-reviewed publications, so the entry set is
  not a neutral survey of the ecosystem. Link to it; do not ingest.
- **LiveBench is a near-miss that one question could fix.** The datasheet grant is unusually generous and explicit,
  but it describes *the benchmark suite* and the data on Hugging Face, and the aggregate score tables live in a
  different, unlicensed repository. The question to put to the maintainers is narrow: *does the Apache 2.0 grant in
  `docs/DATASHEET.md` cover the score tables in `LiveBench/new-livebench/public/`, and what attribution do you want?*
  Until that is answered in writing, this stays unresolved.
- **BFCL is the only written grant that names the results.** "All the leaderboard statistics … are released under
  Apache 2.0" is exactly the sentence layer 2 asks for.
- **Aider is cleanly licensed but nearly a year stale**, which makes it a poor first source regardless of rights.

## 2. Recommended canonical benchmark-result shape

Drawn from what all four actually publish, not from what a schema would prefer.

```
benchmark_result
  benchmark          which benchmark          all four
  task               subtask / split / category within it   LiveBench(22), BFCL(~30), SWE-bench(split), Aider(one)
  metric             what the number measures  all four
  subject            the model variant or artifact   all four
  value              the score                 all four
  sample_numerator   items passed              Aider (pass_num), SWE-bench (len(resolved))
  sample_count       items attempted           Aider (test_cases), SWE-bench (split size), LiveBench (nq, cost file)
  stderr             standard error            NONE of the four — nullable, probably long empty
  measured_on        when it was run           Aider (date), SWE-bench (folder), LiveBench (release)
  source_version     the source's own version  LiveBench release, BFCL V1-V4, SWE-bench split, Aider commit_hash
  origin             evidence layer            see the refinement below
  source_record_id   the snapshot it came from all four
  citation_url       the page it can be read on all four
  evaluation_config  -> sibling row, below
```

```
evaluation_config
  harness            name of the harness/scaffold   LiveBench, Aider, BFCL, SWE-bench (agent)
  harness_version    its version                    Aider (versions/commit_hash), SWE-bench (folder), BFCL (V-number)
  mode               how the model was addressed    BFCL (FC vs prompt), Aider (edit_format)
  reasoning_effort   thinking budget / effort       LiveBench (in the model string), Aider (reasoning_effort)
  attempts           retries allowed                Aider (pass_rate_1 vs _2), SWE-bench (tags.system.attempts)
  invocation         the exact command, verbatim    Aider (command)
  shots              few-shot count                 none of the four; needed for lm-eval-harness later
  parameters         jsonb, anything else
```

Three findings that the shape above is built around, and that neither `benchmarks.md` nor ADR-0010 anticipated:

**a. None of the four publishes score uncertainty; three publish counts.** ADR-0010's G5 asked for `stderr` first.
That was the wrong priority. `sample_numerator` / `sample_count` are available today from Aider and SWE-bench and
make "51.6%" auditable as "116 of 225"; `stderr` should exist but will be null almost everywhere.

**b. A benchmark has three levels, not two.** Mutinai models `benchmark → benchmark_metric`. LiveBench is
release → 7 categories → 22 subtasks → score; BFCL is version → category → column. Averaging across subtasks is a
*display* operation — LiveBench is explicit that overall and per-category averages "are never stored in the CSV" —
so Mutinai should store the subtask scores and compute the roll-up, never ingest someone's average as a fact.

**c. The unit being scored is often a model *as configured*, not a model.** `claude-opus-4-5-…-thinking-64k-high-effort`
and `meta-llama/Llama-3.1-8B-Instruct-FC` are not distinct sets of weights. Mutinai's `model_variant` is a weights-level
concept, and creating a variant per leaderboard row would fabricate models that do not exist. The configuration has to
live in `evaluation_config`, with the result still pointing at the real variant.

## 3. Minimum migration to support these correctly

Beyond ADR-0010's existing list, and still not applied:

1. **`ingest.source`**: `license_id`, `attribution_text`, `terms_url`, `redistribution_allowed boolean not null default false`.
   Ingestion refuses to run against a source where the flag is false. This lets SWE-bench exist as a link-only row.
   *(ADR-0010 G3.)*
2. **`ecosystem.result_origin`**: replace with `developer_reported`, `independent`, `mutinai_run`, `editorial` via a
   new type and a column swap. *(G1 — see ADR-0010 for the transaction caveat.)*
3. **New `ecosystem.evaluation_config`** with the columns above, and `benchmark_result.evaluation_config_id`. Do **not**
   reuse `run_environment`: its `runtime_id not null` and `run_environment_one_hardware` check make a
   hardware-free capability evaluation unrepresentable. *(G4, refined.)*
4. **`benchmark_result`**: add `task text`, `sample_numerator integer`, `sample_count integer`, `stderr double precision`,
   `source_version text`. *(G5, reprioritised, plus the three-level finding.)*
5. **`benchmark_result`**: check constraint `num_nonnulls(citation_url, source_record_id) >= 1`. *(G6.)*
6. **Index** `(benchmark_id, metric_id, task, variant_id, artifact_id, evaluation_config_id, source_record_id)` unique,
   so re-ingesting one snapshot cannot duplicate rows while different sources still coexist. *(G7.)*

Not in this migration, and deliberately: no cost or latency columns (see §4), no supersession flag (G10 — still not
needed until a source corrects a published number).

## 4. Keep in raw provenance, not as canonical columns

The snapshot in the object store keeps the whole payload regardless; these are the fields that should *stay* there
rather than being promoted:

- **Rank.** A position in someone else's table, invalidated by the next submission. Mutinai orders its own lists.
- **Cost and price** — BFCL `Total Cost ($)`, Aider `total_cost`, LiveBench `cost_<release>.csv`, BFCL's
  `input_price`/`output_price`. These are facts about a *vendor's API pricing on the day of the run*, not about a
  model, and they decay fast. Mutinai's subject is models you run yourself, where the relevant cost is hardware.
- **Latency** — BFCL `Latency Mean/Std/95th`, Aider `seconds_per_case`. Measured against an API endpoint under
  unknown load, with no hardware recorded. Mutinai's performance results mean something specific (this artifact, this
  runtime, this device); mixing these in would corrupt that.
- **Failure-mode counters** — Aider's `syntax_errors`, `lazy_comments`, `indentation_errors`, `user_asks`,
  `exhausted_context_windows`, `num_malformed_responses`; LiveBench's token averages. Genuinely interesting, specific
  to one harness, and not comparable across sources.
- **Source presentation** — `Model Link`, `logo`, `displayName`, `info.site`.
- **SWE-bench instance lists** — `resolved[]`, `resolved_by_repo`, `resolved_by_time`. 333 issue ids is the evidence
  for one number, and belongs in the snapshot, not in 333 rows.
- **Aider's `dirname`, SWE-bench's folder name** — useful as the dedupe external id, not as a displayed field.

Two that are borderline and should be promoted only when a second source also reports them:
`percent_cases_well_formed` (Aider) and `Format Sensitivity Standard Deviation` (BFCL) both measure *reliability of
output shape*, which is a real and under-reported property of open models.

## 5. Which one to implement first

**LiveBench — conditional on one licensing answer, which must arrive before any ingestion runs.**

Why it is the right first source:

- **It is about the models Mutinai exists for.** `modelLinks.js` flags `openweight: true` and carries an explicit
  `huggingface:` URL for most open models (GLM, Kimi, DeepSeek, Qwen, Gemma, gpt-oss, Nemotron). That URL maps
  straight onto Mutinai's existing `huggingface` identifier namespace, so entity resolution is solved by the source
  itself rather than by fuzzy name matching.
- **The data is genuinely fetchable, and I verified it end-to-end**: `table_2026_06_25.csv` is 58 models × 22 subtask
  columns of plain CSV over `raw.githubusercontent.com`, no auth, no HTML, no Hugging Face dependency — which matters,
  given HF is not reachable from this environment at all.
- **It is the freshest of the four** (score commits on 2026-09-16) and the only one whose history is already
  partitioned into immutable per-release files, which is exactly the shape ADR-0009's freshness rules want.
- **It exercises the hard parts immediately.** 22 subtasks per model forces the three-level benchmark finding and the
  "multiple results coexist" rule to be real on day one, instead of a rule with one row behind it.

**The condition.** The score tables live in `LiveBench/new-livebench`, which has no LICENSE file. The Apache 2.0 grant
is in the main repo's datasheet and describes the benchmark suite. That gap must be closed in writing — one GitHub
issue asking whether the datasheet's grant covers `public/table_*.csv` and what attribution they want — before an
adapter writes a single row. Treat it as unresolved until then, exactly as the policy requires.

**If that answer does not come, implement BFCL instead.** It is the only one of the four whose licence explicitly
names the leaderboard statistics, and its Hugging Face repo ids are the best model identifiers of the set. Its
drawbacks are real but survivable: a slowing update cadence, and a published file I could not inspect from here.

**Do not implement SWE-bench or Aider Polyglot first.** SWE-bench has no licence on its results and an
academic-submitters-only policy that makes its entry set unrepresentative; Aider's leaderboard has not been updated
since October 2025.
