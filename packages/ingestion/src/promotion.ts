/**
 * Automatic promotion of first-party root weights to catalog structure (docs/live-ingestion.md#first-party-releases).
 *
 * A release, model and variant are created only when every rule holds, from source evidence: the publisher is a known
 * developer, the repo name places it in one of that developer's families, config.json states the architecture,
 * safetensors metadata agrees with the size in the name, mixture-of-experts models name their active parameters, and the
 * source dates the publication. Any failure creates nothing and is reported for review. When only the variant kind is
 * unstated (no Base/Instruct/… token), release and model are created and the variant waits for an editor.
 */
import { matchFamily, modelNameFor, parseModelRepoName, releaseNameFor, variantKindFromSuffix, type Architecture, type VariantKind } from '@mutinai/domain';
import type { ObservedModelFacts } from './adapter';

/** Safetensors totals include vision encoders and MTP layers, so the named size is compared with this tolerance. */
export const PARAMS_TOLERANCE = 0.15;

export type PromotionRule =
  | 'publisher_not_known_developer'
  | 'name_not_parsed'
  | 'no_matching_family'
  | 'ambiguous_family'
  | 'architecture_facts_incomplete'
  | 'parameter_count_missing'
  | 'name_size_mismatch'
  | 'moe_active_params_unknown'
  | 'dense_with_active_params'
  | 'unrecognised_name_tokens'
  | 'release_date_unknown';

export interface PromotionFailure {
  rule: PromotionRule;
  detail: string;
}

export interface PromotionInput<F extends { id: string; name: string }> {
  /** Hugging Face repo id, e.g. `Qwen/Qwen3.8-27B`. */
  repo: string;
  /** Name of the publishing organization when it develops at least one family; null otherwise. */
  developerName: string | null;
  /** Families developed by the publisher. */
  families: readonly F[];
  observed?: ObservedModelFacts;
  /** Publication date stated by the source (YYYY-MM-DD). Ingest time is never a substitute. */
  releasedOn?: string;
}

export interface PromotionPlan<F> {
  family: F;
  releaseName: string;
  modelName: string;
  releasedOn: string;
  model: { architecture: Architecture; paramsTotal: number; paramsActive: number | null; layers: number; attentionHeads: number; kvHeads: number; headDim: number; contextLength: number };
  /** Null when the name states no variant kind: structure is created, the variant is left for review. */
  variantKind: VariantKind | null;
  evidence: string[];
}

const ARCHITECTURE_FACTS = ['layers', 'attentionHeads', 'kvHeads', 'headDim', 'contextLength'] as const;

export function planFirstPartyRelease<F extends { id: string; name: string }>(input: PromotionInput<F>): { plan: PromotionPlan<F> | null; failures: PromotionFailure[]; evidence: string[] } {
  const failures: PromotionFailure[] = [];
  const evidence: string[] = [];
  const fail = (rule: PromotionRule, detail: string) => failures.push({ rule, detail });
  const [owner = '', name = ''] = input.repo.split('/');

  if (!input.developerName || !input.families.length) fail('publisher_not_known_developer', `${owner} is not the developer of any model family in the catalog`);
  else evidence.push(`publisher ${owner} is ${input.developerName}, developer of ${input.families.map((f) => f.name).join(', ')}`);

  const parsed = parseModelRepoName(name);
  if (!parsed) fail('name_not_parsed', `${name} does not follow <name><version>-<size>B[-A<active>B][-<suffix>]`);

  let family: F | null = null;
  if (parsed && input.families.length) {
    const match = matchFamily(parsed, input.families);
    if (!match) fail('no_matching_family', `no ${input.developerName} family matches "${[...parsed.brand, ...parsed.line].join(' ')}"`);
    else if ('ambiguous' in match) fail('ambiguous_family', `"${parsed.brand.join(' ')}" matches ${match.ambiguous.map((f) => f.name).join(' and ')}`);
    else {
      family = match.family;
      evidence.push(`repo name ${name} belongs to family ${family.name}`);
    }
  }

  const o = input.observed ?? {};
  const missing = ARCHITECTURE_FACTS.filter((k) => !(Number(o[k]) > 0));
  if (missing.length) fail('architecture_facts_incomplete', `config.json does not state ${missing.join(', ')}`);
  else evidence.push(`config.json: ${o.layers} layers, ${o.attentionHeads} attention heads, ${o.kvHeads} KV heads, head dim ${o.headDim}, context ${o.contextLength}`);

  if (!o.paramsTotal) fail('parameter_count_missing', 'safetensors metadata states no parameter count');
  else if (parsed) {
    const named = parsed.sizeB * 1e9;
    if (Math.abs(o.paramsTotal / named - 1) > PARAMS_TOLERANCE) fail('name_size_mismatch', `${parsed.sizeToken} in the name, ${o.paramsTotal.toLocaleString('en-US')} parameters in safetensors metadata`);
    else evidence.push(`safetensors metadata: ${o.paramsTotal.toLocaleString('en-US')} parameters, consistent with ${parsed.sizeToken}`);
  }

  const moe = (o.experts ?? 0) > 1;
  if (parsed && moe && parsed.activeB == null) fail('moe_active_params_unknown', `config.json declares ${o.experts} experts but the name states no active parameters`);
  if (parsed && !moe && parsed.activeB != null) fail('dense_with_active_params', `${parsed.activeToken} in the name but config.json declares no experts`);
  if (parsed && moe && parsed.activeB != null) evidence.push(`${o.experts} experts (${o.expertsPerToken ?? 'unstated'} per token); ${parsed.activeToken} active parameters as named by the publisher`);

  if (!input.releasedOn) fail('release_date_unknown', 'the source states no publication date');
  else evidence.push(`published ${input.releasedOn} (Hugging Face repository creation date)`);

  let variantKind: VariantKind | null = null;
  if (parsed) {
    const kind = variantKindFromSuffix(parsed.suffix);
    if (kind.unrecognized.length) fail('unrecognised_name_tokens', `name tokens not recognised: ${kind.unrecognized.join(', ')}`);
    variantKind = kind.kind;
    if (kind.kind) evidence.push(`variant kind ${kind.kind} stated by the name`);
  }

  if (failures.length || !parsed || !family) return { plan: null, failures, evidence };
  const releaseName = releaseNameFor(parsed, family.name);
  return {
    plan: {
      family,
      releaseName,
      modelName: modelNameFor(parsed, releaseName),
      releasedOn: input.releasedOn!,
      model: {
        architecture: moe ? 'moe' : 'dense',
        paramsTotal: o.paramsTotal!,
        paramsActive: moe ? Math.round(parsed.activeB! * 1e9) : null,
        layers: o.layers!,
        attentionHeads: o.attentionHeads!,
        kvHeads: o.kvHeads!,
        headDim: o.headDim!,
        contextLength: o.contextLength!,
      },
      variantKind,
      evidence,
    },
    failures: [],
    evidence,
  };
}
