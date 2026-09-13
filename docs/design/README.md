# Mutinai visual direction

Status: accepted · 2026-09-12 · revised 2026-09-12 (information modes, discovery by intent, cool colour system). Prototypes: [`directions/`](./directions) (serve the repo root statically, e.g.
`python3 -m http.server 3200`, then open `/docs/design/directions/a-observatory.html` etc.). All three use the same
seeded data and the same surfaces: Discover opening, Happening now, a Models directory section and a model summary.

## Problem

The foundation UI was a database console; the hierarchy pass overcorrected into a sparse marketing site
("Happening now" began at 805px on a 913px viewport; two model results fit on the first screen). Mutinai needs
medium density with strong hierarchy, a recognisable identity, and structured data that can be *seen*, for people
who visit repeatedly.

## Directions explored

### A · Observatory
Instrument panel. Instrument Sans (width axis) for everything, JetBrains Mono for values; graphite surfaces in three
tonal steps; phosphor-chartreuse accent; signal strip with sparklines; geometric entity glyphs (● model, ■ hardware,
▲ tool, ◆ benchmark, — event); tonal panels instead of borders; right rail with benchmark step chart, activity heat
and community voices.

- + Most information in the first viewport; strongest data visuals (capability profile, memory scale, heat).
- − Panels everywhere drift towards dashboard-widget soup; chartreuse reads crypto/dev-tool; memory dot resembles a slider.

### B · Almanac
Editorial broadsheet. Source Serif 4 (optical sizes) for headlines and names, Schibsted Grotesk for text; warm ink
with vermilion; dateline, double rules, column rules, small-caps kickers ("● MODEL RELEASE"); typographic charts
(thin bar rules, dot plots, standings table).

- + Most distinctive and calm; typography carries identity; the front page genuinely feels like "open models today"; entity kickers work without colour.
- − Directory rows read like articles rather than a tool; hairline charts too faint to scan; vermilion ≈ the old coral.

### C · Field Guide
Specimen index. Condensed Archivo in caps, JetBrains Mono; cool slate with ochre; taxonomy code tags (MDL, HW, TOOL);
a vertical time axis whose nodes take the entity's shape; segmented meters; bordered index tables.

- + Time axis with shaped nodes is the best representation of "Happening now"; segmented meters scan fastest.
- − All-caps condensed + code tags + borders tip into industrial/hacker cosplay; heavy for daily use.

## Evaluation

| Need | A | B | C |
|---|---|---|---|
| First-viewport information | ●●● | ●● | ●●● |
| Calm for repeated daily use | ●● | ●●● | ● |
| Distinctive, not generic | ●● | ●●● | ●● |
| Structured data visible at a glance | ●●● | ● | ●●● |
| Works for directories/tools | ●●● | ● | ●●● |
| Works for editorial/learning | ● | ●●● | ● |
| Entity types recognisable without colour | ●● | ●●● | ●●● |

## Decision: synthesis

No single direction serves an observatory that is also a tool, a learning resource and a community. The chosen
system combines compatible parts:

- **From B — identity and hierarchy.** A serif display face for editorial moments and entity names (page titles,
  lead story, model/hardware/tool names on detail pages); glyph + word kickers for entity types.
- **From A — interface and data grammar.** Instrument Sans for interface and body; tonal surface depth used for
  a few primary regions only; capability profile bars, memory scale, sparklines and activity heat.
- **From C — time and state.** The time-axis feed with entity-shaped nodes for events; segmented meters for
  fit and ratings.

### Typography
- **Display:** Source Serif 4 (variable, optical size). Titles, lead headlines, entity names. Never for UI chrome or data.
- **Interface/body:** Instrument Sans (variable, width). 14px base for dense surfaces, 15–16px for reading; width 92–100.
- **Data:** JetBrains Mono, tabular — numbers, sizes, quantization names, versions. Never for prose or headings.

### Colour (dark primary, light supported)
The first synthesis used saffron on warm ink; it read brown and retro. Revised to a cool dark system:
- Near-black base (`--bg` ≈ #080B0D) with cool charcoal/slate surfaces (`--raised`, `--sunken`, `--hover`), barely saturated.
- Text hierarchy in cool off-white and slate: `--ink`, `--ink-2`, `--muted`, `--faint`.
- **Primary accent: electric mint** (`--accent`) — brand mark, selected state, current navigation, the lead story rule,
  activity and trend marks, primary actions. Used as a signal, never as decoration.
- **Secondary: cool blue** (`--data`) — data marks (capability profile, model glyph), "new" badges, intent explanations.
- Semantic colours (fit, verification, license state) only where they carry meaning, always paired with a shape.
- Restraint rules: no glows, neon borders, gradients or terminal green-on-black. Most of the interface stays neutral;
  structured data provides the visual interest. Light mode mirrors the same roles with darker mint/blue for contrast.

### Entity language
| Entity | Glyph | Word | Hue |
|---|---|---|---|
| Model / variant / download | ● filled circle (◐ variant, ○ download) | Model | data blue |
| Hardware / system | ■ square (□ system) | Hardware | slate cyan |
| Tool / runtime | ▲ triangle | Tool | lavender |
| Benchmark | ◆ diamond | Benchmark | rose |
| Event / release | ▬ bar | Release, Launch… | neutral |
| Member / contribution | initial avatar | @handle | per-handle hue |

### Progressive information resolution
Beginners organise the world around questions; experts around entities and data. Both are first-class, so density is
not uniform — it is chosen.

- **Simple | Technical** switch on directories (Models, Hardware), remembered per browser in the `mutinai_info` cookie
  (a plain form + server action, so it works without JavaScript). Default: Simple.
- **Simple** shows decision-relevant statements with no glyphs to decode: what the model is for, approximate memory and
  a familiar machine it fits, license openness in words (permissive / restricted / non-commercial — never a bare
  "open", and never "open source" for open-weight models), reach across reference systems, community signal.
- **Technical** keeps the compact index: parameters and active parameters, architecture, context, capability profile,
  memory scale, systems meter, license state, activity, compare controls; hardware bandwidth, 4-bit capacity, $/GB.
- **Intent before catalog.** Models open with "What are you looking for?" (Coding, Run locally, Reasoning, Vision,
  Agents & tool use, Fast, Small, Permissive licenses) and a three-list shortlist; Hardware opens with goals
  (first machine, GPU upgrade, Apple/unified, workstation, server/multi-GPU). Each path filters, ranks and explains.
  In Technical mode these collapse into chips and the catalog starts immediately.
- **Hardware is grouped by buying context** (graphics cards, Apple silicon & unified memory, complete systems,
  server & multi-GPU); manufacturer remains a filter.
- Intent definitions and plain-language phrasing are pure, tested functions in `packages/domain/src/discovery.ts`.

### Composition and spacing
Density is chunked, not uniform: a reader squinting at a page should still see its regions.
- Spacing scale `--s1`…`--s7` (4, 8, 12, 16, 24, 32, 56px): small within one object, medium between related objects,
  large (`.region`, 56px; 40px on phones) between conceptual sections.
- **Discover** reads in one order: opening (headline, two actions, four plain numbers — no miniature charts) → top
  story with model snapshot → Latest + Trending/community → Ecosystem trends (benchmark frontier and monthly releases,
  given room) → What can I run? → Explore Mutinai (question links, gateways) → Learn.
- **Models Simple**: intent grid and a single "Good places to start" strip form one discovery layer; a large gap and
  a larger heading mark the start of All models; each result is a lightly contained object with identity and
  decision information separated by a rule. Technical mode starts the dense index immediately.
- **Hardware Simple** is product browsing: two cards per row (one on narrow screens) with a fixed 4:3 image frame,
  name, maker and class, a plain positioning line, a three-cell spec strip (memory, capacity, price) and a measurement
  signal. Technical mode keeps the comparison index (memory scales, bandwidth, 4-bit capacity, $/GB, counts).

### Hardware imagery and prices
- Devices and reference systems have nullable `image_url` / `image_credit` (migration 0002). Images must be properly
  sourced and credited; nothing is fetched or scraped. Without an image the frame shows a class placeholder.
- A price is always shown with its meaning (`PriceQuote`: amount, currency, kind, source, checked date;
  `formatPrice` in `packages/domain`). Kinds: `msrp`, `observed`, `used`, `estimate`. Observed and used prices show
  their check date. Current fixture data holds only device launch MSRPs and editorial build-cost estimates for
  reference systems, labelled as such; no current prices are shown.

### Visualisations
Capability profile (four bars: coding, reasoning, knowledge, instruction — relative to the best open result in the
catalog), memory scale (log 4–256 GB with 8/24/96 marks), fit meter (systems where a model runs well, as segments),
release activity bars, benchmark frontier step chart, rating distribution, activity heat, lineage tree, speed range bars.

### Motion
Only for state: disclosure expansion, filter chip state, compare selection, hover on data marks. All disabled under
`prefers-reduced-motion`.
