# ADR-0006: "What can I run?" compatibility engine

Status: accepted · 2026-09-12

## Decision
Compatibility is computed in `packages/domain/src/compat` as a pure function of:

- **Hardware memory topology**: dedicated accelerator memory (sum across devices),
  unified memory (with a usable fraction, default 75% on Apple silicon, tunable per device),
  system RAM, and memory bandwidth of each pool.
- **Artifact footprint**: artifact byte size (or params × bits-per-weight), plus
  KV cache at the requested context (`2 × layers × kv_heads × head_dim × ctx × bytes`,
  or a per-model override for architectures such as MLA), plus runtime overhead.
- **Runtime support**: runtime supports the artifact format and a backend present
  on the hardware; partial offload only for runtimes that support it.

Output per (artifact, runtime):
- `fit`: `full` | `tight` (>90% of usable accelerator memory) | `offload` | `none`
- memory breakdown
- `speed`: **measured** (median of verified community submissions and canonical
  results for the same config + artifact + runtime, with evidence count) or
  **estimated** (bandwidth ÷ active weight bytes × efficiency, with offload penalty),
  never mixed without labelling.

## Why
The key quantities are well understood and deterministic; community measurements
progressively replace estimates. Keeping it pure makes it testable and portable.

## Consequences
Estimates are coarse (±30–50%). The UI must show the basis of every number.
