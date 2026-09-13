# Mutinai visual direction

Status: accepted · 2026-09-12. Prototypes: [`directions/`](./directions) (serve the repo root statically, e.g.
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

- + Most distinctive and calm; typography carries identity; the front page genuinely feels like "open AI today"; entity kickers work without colour.
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
- Warm ink surfaces in three tonal steps (`--bg`, `--raised`, `--sunken`) rather than borders everywhere.
- Text hierarchy: `--ink`, `--ink-2`, `--muted`, `--faint`.
- **Primary accent: saffron** — brand mark, primary actions, current navigation, the one highlight per visual.
- Entity hues are desaturated and always paired with a shape and a word.
- Status colours (fit, verification) are paired with a glyph so colour is never the only carrier.

### Entity language
| Entity | Glyph | Word | Hue |
|---|---|---|---|
| Model / variant / download | ● filled circle (◐ variant, ○ download) | Model | saffron-tinted |
| Hardware / system | ■ square (□ system) | Hardware | teal |
| Tool / runtime | ▲ triangle | Tool | green |
| Benchmark | ◆ diamond | Benchmark | lilac |
| Event / release | ▬ bar | Release, Launch… | neutral |
| Member / contribution | initial avatar | @handle | per-handle hue |

### Visualisations
Capability profile (four bars: coding, reasoning, knowledge, instruction — relative to the best open result in the
catalog), memory scale (log 4–256 GB with 8/24/96 marks), fit meter (systems where a model runs well, as segments),
release activity bars, benchmark frontier step chart, rating distribution, activity heat, lineage tree, speed range bars.

### Motion
Only for state: disclosure expansion, filter chip state, compare selection, hover on data marks. All disabled under
`prefers-reduced-motion`.
