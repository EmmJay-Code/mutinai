# Independent benchmark sources: findings (researched 2026-09-17)

Four candidate layer-2 sources were inspected against the gate in [benchmarks.md](./benchmarks.md): reuse must
actually be permitted, and the evaluation must be described well enough to compare.

This is the research record. The *registered* state of each source — what is in `ecosystem.result_source` and whether
it is enabled — is in [sources.md](./sources.md#benchmark-result-sources), and the schema that holds the results is
[ADR-0010](./adr/0010-benchmark-results.md). No adapter has been written for any of them.

**Which repository publishes the tables — settled 2026-09-17 against live GitHub.** This went back and forth twice,
so the evidence is recorded here rather than the conclusion alone.

The first pass recorded the tables at `LiveBench/new-livebench/public/table_*.csv`. A second pass claimed that path
did not exist and moved everything to `livebench.github.io`. **The second pass was wrong, and the first was right.**
Verified directly:

- Both repositories contain all 11 `public/table_*.csv` releases. Neither path is missing.
- `new-livebench`'s `gh-pages` branch carries `CNAME = livebench.ai`, and its Pages deployment is registered to that
  domain. `livebench.github.io` deploys to `livebench.github.io` with no custom domain.
- `https://livebench.ai/table_2026_06_25.csv` is **byte-identical** to `new-livebench`'s copy and differs from
  `livebench.github.io`'s.
- `new-livebench`'s tables were last written 2026-09-16; `livebench.github.io`'s 2026-07-06.

So **`LiveBench/new-livebench` is the live publisher** and is what `reference.ts` registers; `livebench.github.io` is
the legacy site repo. Both lack a licence file, so the licensing question is unchanged in substance — but it is about
`new-livebench`.

Figures: the 2026-06-25 table has **23 task columns under 7 categories over 58 model rows** in `new-livebench` (the
site repo's stale copy has 28 rows). The first pass's "22 subtasks" was a miscount and its "58 models" was correct;
the second pass's "23 tasks" was correct and its "28 rows" was read from the stale repository.

**What could not be checked in the first pass.** `huggingface.co` was blocked by that session's network egress
policy, as were `livebench.ai`, `swebench.com`, `gorilla.cs.berkeley.edu` and `aider.chat`; everything was read from
GitHub. Items still resting on that limitation are marked *unverified* below rather than guessed.

## 1. Source-by-source findings

| | **LiveBench** | **SWE-bench** | **Aider Polyglot** | **BFCL** |
| --- | --- | --- | --- | --- |
| **Official data source** | `github.com/LiveBench/new-livebench`, `public/table_<release>.csv` — the repo serving `livebench.ai` (harness: `github.com/LiveBench/LiveBench`) | `github.com/SWE-bench/experiments`, `evaluation/<split>/<entry>/` (harness: `SWE-bench/SWE-bench`) | `github.com/Aider-AI/aider`, `aider/website/_data/polyglot_leaderboard.yml` | `github.com/ShishirPatil/gorilla`, `berkeley-function-call-leaderboard/` |
| **Structured data?** | Yes — CSV, one row per model, one column per task, with `public/categories_<release>.json` grouping the tasks | Partly — `metadata.yaml` + `results/results.json`, one directory per submission. **No score field**: the number is `len(resolved) / split size`, computed by the reader | Yes — YAML, one record per run | Yes — per-model, per-category score files headed `{"accuracy", "correct_count", "total_count"}`; published columns in `bfcl_eval/constants/column_headers.py`. Score files are generated locally and not committed, so counts come from the published leaderboard |
| **Licence on the results** | **Unresolved.** `LiveBench/LiveBench` carries an Apache 2.0 `LICENSE` (prefaced "The original LICENSE from FastChat is copied below"; GitHub reads it as `NOASSERTION`), and `docs/DATASHEET.md` says the suite is "distributed under the Apache License 2.0", "no copyrights on the data", "no fees or restrictions" — **but that section is about distributing the question set via `huggingface.co/livebench`**, and those HF datasets declare no licence tag. `new-livebench`, which publishes the score CSVs, **has no LICENSE file** | **Unresolved.** `SWE-bench/SWE-bench` is MIT, but `SWE-bench/experiments`, which holds the leaderboard entries, **has no LICENSE file** and its README makes no licence, terms or copyright statement. Entries are third-party submissions | **Apache 2.0.** `LICENSE.txt` at the repo root, no carve-out for `website/_data`. (The *exercises* are Exercism's, but those are task inputs, not results) | **Apache 2.0, explicit.** README: "All the leaderboard statistics, and data used to train the models are released under Apache 2.0" — the only one of the four that names the statistics |
| **Attribution required** | Apache 2.0 notice + paper citation (BibTeX in README) | Unresolved; the SWE-bench paper citation is the customary form | Apache 2.0 notice; credit Aider | Apache 2.0 notice; README gives a Gorilla paper citation but **no BFCL-specific BibTeX** |
| **Redistribution on Mutinai** | **Unresolved** — registered and blocked | **No / unresolved** — do not ingest | **Permitted** | **Permitted** |
| **Fields per result** | `model` plus one column per task, raw 0–100; the 2026-06-25 table has 23 task columns under 7 categories. Optional `cost_<release>.csv`: per-task total cost, `nq_<subtask>` question counts, `avg_input_tokens`, `avg_output_tokens`, `input_price_per_million`, `output_price_per_million` | `metadata.yaml`: `info.name/site/logo`, `tags.model[]`, `tags.org`, `tags.agent`, `tags.agent_org`, `tags.model_org`, `tags.model_display`, `tags.os_model`, `tags.os_system`, `tags.system.attempts`, `tags.checked`, `assets.logs/trajs`. `results/`: `results.json` (`resolved[]`, `no_generation[]`, `no_logs[]`), `resolved_by_repo.json`, `resolved_by_time.json` | 30 keys per run, including `model`, `edit_format`, `editor_model`, `editor_edit_format`, `reasoning_effort`, `pass_rate_1/2`, `pass_num_1/2`, `test_cases`, `total_tests`, `percent_cases_well_formed`, `num_malformed_responses`, `exhausted_context_windows`, `test_timeouts`, `syntax_errors`, `prompt_tokens`, `completion_tokens`, `thinking_tokens`, `total_cost`, `seconds_per_case`, `command`, `commit_hash`, `versions`, `date`, `dirname` | 37 columns (`COLUMNS_OVERALL`): `Rank`, `Overall Acc`, `Model`, `Model Link`, `Total Cost ($)`, `Latency Mean/Std/95th`, then per-category accuracies (Non-Live AST, Live, Multi Turn, Web Search, Memory), `Relevance`/`Irrelevance Detection`, `Format Sensitivity Max Delta`/`Standard Deviation`, `Organization`, `License` |
| **Model identifier** | Runner string, e.g. `claude-opus-4-5-20251101-thinking-64k-high-effort`, resolved through `src/Table/modelLinks.js` — **present in the publishing repo and verified 2026-09-17**. 282 entries giving `organization`, `displayName`, `openweight`, `reasoner` and often an explicit `huggingface:` repo URL, plus a `variants` list that `getVariantGroup` uses to fold effort variants into a base model. Of the 58 rows in the 2026-06-25 table, 56 resolve (46 directly, 10 as variants) and **18 of the 19 open-weight rows carry an HF URL** (only `inkling-xhigh` does not). A model absent from it is hidden from the leaderboard | Vendor API names in `tags.model[]` (e.g. `claude-4-sonnet-20250514`), plus `os_model` / `os_system` booleans. No HF ids | Free-text display names: `"Qwen3 235B A22B diff, no think, Alibaba API"`, `"DeepSeek R1 (0528)"`. No HF ids, no open/closed flag | **Hugging Face repo ids** for open models: `meta-llama/Llama-3.1-8B-Instruct`, `google/gemma-3-27b-it`, with a `-FC` key suffix for function-calling mode. `model_config.py` also carries `org`, `license`, `url`, `input_price`, `output_price`, `is_fc_model` |
| **Benchmark/task id** | Task column name (`code_generation`, `zebra_puzzle`, …) inside a release date | Split (`lite`, `verified`, `multimodal`, `multilingual`, `test`) | The polyglot suite as a whole; 225 exercises across 6 languages, **published with no per-language breakdown** | Category column name (`category_mapping.py`); version prefix `BFCL_v4` |
| **Score format** | Float 0–100 per task. Category and overall averages are **computed by the site and never stored in the CSV** | Derived: resolved count ÷ split size. Also per-repo and per-year breakdowns | `pass_rate_2` percent (after 2 attempts) plus `pass_num_2` / `test_cases` counts; `pass_rate_1` is the first attempt | Accuracy per category. **Overall is a mixture**: unweighted means within the non-live, multi-turn and agentic groups, a sample-weighted mean within the live group, then `[10, 10, 10, 30, 40]` across the groups — beside a `TODO: adjust the weights` |
| **Date / version** | Release folder date (`2026_06_25`); 11 releases from `2024_06_24` | Submission folder `YYYYMMDD_<system>_<model>`; git history | `date` (run date), `versions` (aider version, e.g. `0.75.2.dev`), `commit_hash` | BFCL version (V1–V4); no per-row date in the columns |
| **Harness version** | Not in the CSV; the release date pins the question set | Agent + scaffold named in `tags`; its version is in the entry folder name (e.g. `mini-v2.4.6`) | **Yes — `versions` and `commit_hash`**, the best of the four | BFCL version only |
| **Prompt / few-shot / config** | Baked into the model string (`-thinking-64k-high-effort`) rather than recorded in fields | `tags.system.attempts` (e.g. 1); the scaffold's prompting lives in the submitter's repo | **`edit_format`, `editor_model`, `editor_edit_format`, `reasoning_effort`, `command`** — the full invocation | `is_fc_model` (function-calling vs prompt mode); `Format Sensitivity` columns measure prompt-format variance |
| **Hardware / runtime** | None | None | None | None (API and local models both run; hardware not recorded) |
| **Sample count / uncertainty** | Question counts only in the optional cost file (`nq_<subtask>`). **No stderr** | `len(resolved)` and the split size give an exact numerator/denominator. No stderr | **`pass_num_1/2` and `test_cases`/`total_tests`** — exact numerator and denominator. No stderr | **None published.** `correct_count`/`total_count` exist only in locally generated score files that are not committed; the published CSV has no count columns. Per-category question counts are fixed properties of the committed BFCL_v4 dataset. `Latency` and `Format Sensitivity` columns are about latency and prompt sensitivity, **not** score uncertainty. No stderr |
| **History kept** | **Yes** — every release's CSV stays in `public/` | **Yes** — every submission directory stays; artifacts moved to submitters' own repos mid-2026, older ones point at `s3://swe-bench-submissions/` | **Yes** — git history of one file | Yes, in repository history |
| **Change frequency** | **High.** Score commits through 2026-09-16; new question releases roughly quarterly | **Moderate, active.** Latest submissions 2026-09-02/03 | **Stale.** Last change to the leaderboard file: **2025-10-04**, ~11 months ago | **Slowing.** Last commit to the leaderboard directory: **2026-03-23**, ~6 months ago |
| **Fetchable without HTML scraping** | **Yes, verified** — plain CSV/JSON over `raw.githubusercontent.com`, no auth | **Yes, verified** — YAML/JSON over `raw.githubusercontent.com`; directory enumeration needs the GitHub API or the repo cloned | **Yes, verified** — one YAML file | **Yes, verified 2026-09-17** — `https://gorilla.cs.berkeley.edu/data_overall.csv`, plain CSV over HTTPS with `Last-Modified` and an ETag. The Hugging Face Space named in the first pass holds no data: it is a three-file static stub last touched August 2024 |

### Licence notes, stated conservatively

- **SWE-bench is the clearest "no" of the four.** The benchmark code is MIT, but the leaderboard entries are in a
  separate repository with no licence at all, contributed by third parties who each retain their own rights. Nothing
  grants Mutinai redistribution. Additionally, since 2025-11-18 SWE-bench Verified and Multilingual accept
  submissions only from academic teams and research institutions with peer-reviewed publications, so the entry set is
  not a neutral survey of the ecosystem. Link to it; do not ingest. It is also not an independent-result source at
  all — see §6.
- **LiveBench is a near-miss that one question could fix.** The datasheet grant is unusually generous and explicit,
  but it describes *the benchmark suite* and the data on Hugging Face, and the score tables live in a different,
  unlicensed repository. The question to put to the maintainers is narrow: *does the Apache 2.0 grant in
  `docs/DATASHEET.md` cover the score tables in `LiveBench/new-livebench/public/`, and what attribution do you
  want?* Until that is answered in writing, this stays unresolved, and the database enforces it. The exact wording to
  send is in §7.
- **BFCL is the only written grant that names the results.** "All the leaderboard statistics … are released under
  Apache 2.0" is exactly the sentence layer 2 asks for.
- **Aider is cleanly licensed but nearly a year stale**, which makes it a poor first source regardless of rights.

## 2. What the findings changed in the schema

The shape proposed in the first pass — a flat `benchmark_result` carrying `origin`, `citation_url` and a sibling
`evaluation_config` — was superseded when the schema was built. Grouping proved to belong one level up: the subject,
origin, environment, provenance and configuration are properties of *one evaluation*, not of each number it produced,
so they moved to `ecosystem.benchmark_run` and `benchmark_result` kept only the measured fact. See ADR-0010 decision 8.

Three findings from this research drove that, and none of them were anticipated by the policy:

**a. None of the four publishes score uncertainty; three publish counts.** The original gap list asked for `stderr`
first. That was the wrong priority. `sample_numerator` / `sample_count` are available today from Aider, SWE-bench and
BFCL and make "51.6%" auditable as "116 of 225". They were implemented; `stderr` was not, because it would have been
a column of nulls.

**b. A benchmark has three levels, not two.** Mutinai modelled `benchmark → benchmark_metric`. LiveBench is
release → 7 categories → 23 tasks → score; BFCL is version → category → column. Averaging across subtasks is a
*display* operation — LiveBench's averages are never stored in the CSV at all, and BFCL's weighting carries a `TODO`
next to it — so Mutinai stores the subtask scores and computes the roll-up. Implemented as `benchmark_subtask` and
`benchmark_run_rollup`.

**c. The unit being scored is often a model *as configured*, not a model.** `claude-opus-4-5-…-thinking-64k-high-effort`
and `meta-llama/Llama-3.1-8B-Instruct-FC` are not distinct sets of weights. Creating a variant per leaderboard row
would fabricate models that do not exist, so the configuration lives in `evaluation_config` with the result still
pointing at the real variant.

The licence findings drove the fourth: `result_source` with an enforced `redistribution` permission. Two of the four
candidates have no licence on their published results, and without that column nothing in the code would stop a future
adapter ingesting them.

## 3. Keep in raw provenance, not as canonical columns

The snapshot in the object store keeps the whole payload regardless; these are the fields that should *stay* there
rather than being promoted. This is implemented as `benchmark_run.raw` (ADR-0010 decision 14).

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
- **Aider's `dirname`, SWE-bench's folder name** — useful as the dedupe external id (`benchmark_run.dedupe_key`), not
  as a displayed field.

Two that are borderline and should be promoted only when a second source also reports them:
`percent_cases_well_formed` (Aider) and `Format Sensitivity Standard Deviation` (BFCL) both measure *reliability of
output shape*, which is a real and under-reported property of open models.

## 4. Which one to implement first

**LiveBench — conditional on one licensing answer, which must arrive before any ingestion runs.**

Why it is the right first source:

- **It is about the models Mutinai exists for.** LiveBench tracks open-weight models and, subject to the re-check
  noted in the table, carries explicit Hugging Face URLs for most of them (GLM, Kimi, DeepSeek, Qwen, Gemma, gpt-oss,
  Nemotron). Those map straight onto Mutinai's existing `huggingface` identifier namespace, so entity resolution is
  solved by the source itself rather than by fuzzy name matching.
- **The data is genuinely fetchable**: `public/table_<release>.csv` is plain CSV over `raw.githubusercontent.com`, no
  auth, no HTML, no Hugging Face dependency.
- **It is the freshest of the four** and the only one whose history is already partitioned into immutable per-release
  files, which is exactly the shape ADR-0009's freshness rules want.
- **It exercises the hard parts immediately.** 23 tasks per model forces the three-level finding and the "multiple
  results coexist" rule to be real on day one, instead of a rule with one row behind it.

**The condition.** The score tables live in `LiveBench/new-livebench`, which has no LICENSE file. The Apache 2.0 grant
is in the harness repo's datasheet and describes the question set distributed on Hugging Face. That gap must be closed
in writing — one issue on `LiveBench/new-livebench` asking whether the datasheet's grant covers `public/table_*.csv`
and what attribution they want — before an adapter writes a single row. **Asked 2026-09-17:
[LiveBench/new-livebench#53](https://github.com/LiveBench/new-livebench/issues/53)**, which is the durable link to
this pending decision. A search of all three repositories beforehand found no existing licence or redistribution issue. The source is registered with
`redistribution = 'unverified'` and `ingestion_enabled = false`, and the database refuses runs against it, so the
condition is enforced rather than remembered.

**If that answer does not come, implement BFCL instead.** It is the only one of the four whose licence explicitly
names the leaderboard statistics, and its Hugging Face repo ids are the best model identifiers of the set. Its
drawbacks are real but survivable: a slowing update cadence, a headline average whose weighting carries a `TODO`, and
a rendered leaderboard file that has not been inspected directly.

**Do not implement SWE-bench or Aider Polyglot first.** SWE-bench has no licence on its results and an
academic-submitters-only policy that makes its entry set unrepresentative; Aider's leaderboard has not been updated
since October 2025.

## 5. What each source needs from an adapter

Recorded here so the next sitting does not re-derive it:

- **LiveBench** — one run per (model string, release). Split the configuration out of the model string rather than
  creating variants. 23 results per run, one per task, each against a `benchmark_subtask`; `rollup_method` is
  `mean_of_subtasks` at both levels. Sample counts only if the optional cost file is taken.
- **BFCL** — **built**; see `packages/ingestion/src/adapters/bfcl.ts` and
  [sources.md](./sources.md#benchmark-result-sources). One run per (model, mode) per dataset generation, keyed
  `bfcl:BFCL_v4:<model_config key>`, with `prompt_mode` distinguishing the `-FC` entries from the plain ones. 18
  category results per run and no counts, because none are published. The group weighting is `weighted_subtasks`
  across the groups, `mean_of_subtasks` within all of them except live, which is `weighted_subtasks` over the fixed
  BFCL_v4 question counts. Two first-pass assumptions were wrong and are corrected there: non-live means four terms
  rather than six, and relevance is excluded from the overall.
- **Aider** — one run per record, keyed by `dirname`. `pass_rate_1` and `pass_rate_2` are two runs differing by
  `attempts`, not two metrics. No subtasks, so no rollup: the result is the whole-benchmark fact.

## 6. SWE-bench is not an independent-result source

Its leaderboard is a registry of externally produced submissions: each entry is a result someone else ran with their
own scaffold and submitted, not a measurement the benchmark's maintainers made. It is therefore not a canonical
independent-result source, and is not registered in `result_source`. If it is ever ingested it belongs under origin
`submitted_registry`, which ranks below an independent run and below Mutinai's own measurement, and each entry's
submitter and scaffold would have to be recorded as part of its provenance.

## 7. The LiveBench licensing question: where to send it, and what to say

**Where.** A new issue on **`github.com/LiveBench/new-livebench`** — the repository that actually publishes the
tables, and which had 2 open issues against the harness repo's 178, so a licensing question will not be lost there.
Issues are enabled on it. Copy the org contact **livebench@livebench.ai** if a written answer is wanted off-GitHub.

**Who.** The same people maintain the harness and the board, several with Abacus.AI affiliations. By commits to
`public/` on `new-livebench`: `lakshvantb` (31), `arvindsun` (14, and the most active committer overall),
`anandnara-abacus` (11); `bindureddy456` also commits to the repo. `arvindsun` or `lakshvantb` are the right people to
@-mention.

**Checked first:** no existing issue in any of the three repositories asks about the licence or redistribution of the
leaderboard data. Issue `LiveBench/LiveBench#61` ("Open weights and commercial license filters") is about filtering
models by *their* licence, not about the leaderboard's own.

**The question, as it should be sent:**

> **Title:** Licence for the leaderboard score tables in `public/table_*.csv`
>
> Hi — we maintain [Mutinai](https://github.com/EmmJay-Code/mutinai), a catalogue of open-weight models, and we would
> like to show LiveBench scores with attribution and a link back, rather than just linking to the site.
>
> Before we ingest anything we want to be sure we are allowed to. Two questions:
>
> 1. `docs/DATASHEET.md` in `LiveBench/LiveBench` says the benchmark suite is "distributed under the Apache License
>    2.0", with "no copyrights on the data" and "no fees or restrictions" — but that section describes the question
>    sets on `huggingface.co/livebench`. Does that same Apache 2.0 grant cover the **leaderboard score tables** in
>    `LiveBench/new-livebench/public/table_*.csv`? That repository has no `LICENSE` file of its own.
> 2. If yes, what attribution would you like displayed next to the numbers — the Apache notice, the LiveBench paper
>    citation, a specific credit line, or something else?
>
> We are happy with any answer, including no. We just need it in writing before we store anything. Thanks for
> maintaining the benchmark.

**Filed 2026-09-17 as [LiveBench/new-livebench#53](https://github.com/LiveBench/new-livebench/issues/53)**, with the
repository link dropped because Mutinai's own repository is private. That issue is the record of this decision; its
URL is also on the `livebench-leaderboard` row's `permission_note`, so it travels with the data.

A "yes" moves the source to `redistribution = 'attribution_required'` with their credit line and
`ingestion_enabled = true`. Anything else, or silence, and LiveBench stays blocked. BFCL is the first source
regardless, since it was already cleared.
