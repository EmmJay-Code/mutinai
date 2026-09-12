/**
 * Ecosystem ontology vocabulary and structural rules.
 *
 * The database enforces referential integrity; this module enforces the semantic
 * rules that a relational schema cannot express cheaply (which entity kinds a
 * relation predicate may connect, what a variant kind implies about lineage, …).
 * See docs/adr/0002-ontology.md.
 */

export const ENTITY_KINDS = [
  'organization',
  'model_family',
  'model_release',
  'model',
  'model_variant',
  'model_artifact',
  'quantization_scheme',
  'hardware_device',
  'hardware_configuration',
  'project',
  'benchmark',
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ORGANIZATION_KINDS = [
  'ai_lab',
  'company',
  'hardware_vendor',
  'academic',
  'community',
  'individual',
] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

/** Post-training / derivation category of a published weight set. */
export const VARIANT_KINDS = [
  'base',
  'instruct',
  'reasoning',
  'coder',
  'vision',
  'distill',
  'fine_tune',
  'merge',
] as const;
export type VariantKind = (typeof VARIANT_KINDS)[number];

export const CAPABILITIES = ['chat', 'code', 'reasoning', 'vision', 'tool_use', 'long_context', 'multilingual'] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const ARCHITECTURES = ['dense', 'moe'] as const;
export type Architecture = (typeof ARCHITECTURES)[number];

export const WEIGHT_FORMATS = ['safetensors', 'gguf', 'mlx', 'exl2'] as const;
export type WeightFormat = (typeof WEIGHT_FORMATS)[number];

export const QUANTIZATION_METHODS = ['native', 'k_quant', 'i_quant', 'legacy_gguf', 'awq', 'gptq', 'fp8', 'mlx', 'exl2'] as const;
export type QuantizationMethod = (typeof QUANTIZATION_METHODS)[number];

export const COMPUTE_BACKENDS = ['cuda', 'rocm', 'metal', 'vulkan', 'cpu'] as const;
export type ComputeBackend = (typeof COMPUTE_BACKENDS)[number];

export const DEVICE_KINDS = ['gpu', 'soc', 'cpu', 'accelerator'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** `dedicated`: fixed on-device memory. `unified`: shared CPU/GPU memory sized per configuration. `none`: uses system RAM. */
export const MEMORY_KINDS = ['dedicated', 'unified', 'none'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const PROJECT_CATEGORIES = [
  'runtime',
  'ui',
  'agent',
  'coding_assistant',
  'fine_tuning',
  'evaluation',
  'gateway',
  'library',
] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export const BENCHMARK_KINDS = ['capability', 'performance'] as const;
export type BenchmarkKind = (typeof BENCHMARK_KINDS)[number];

export const EVENT_KINDS = [
  'model_release',
  'runtime_release',
  'hardware_launch',
  'benchmark_update',
  'announcement',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_ENTITY_ROLES = ['subject', 'related'] as const;
export type EventEntityRole = (typeof EVENT_ENTITY_ROLES)[number];

/**
 * Typed cross-cutting relationships. Hierarchical ownership (family → release → model → variant → artifact)
 * is expressed with foreign keys, not relations.
 */
export const RELATION_RULES = {
  fine_tuned_from: { subject: ['model_variant'], object: ['model_variant'], description: 'Weights were fine-tuned from another variant' },
  distilled_from: { subject: ['model_variant'], object: ['model_variant'], description: 'Trained on outputs of a teacher variant' },
  merged_from: { subject: ['model_variant'], object: ['model_variant'], description: 'Weight merge including this parent' },
  successor_of: {
    subject: ['model_release', 'model', 'hardware_device', 'project'],
    object: ['model_release', 'model', 'hardware_device', 'project'],
    sameKind: true,
    description: 'Newer generation of the object',
  },
  built_on: { subject: ['project'], object: ['project'], description: 'Project embeds or wraps another project' },
  integrates_with: { subject: ['project'], object: ['project'], description: 'Project provides an integration with another' },
  implements_benchmark: { subject: ['project'], object: ['benchmark'], description: 'Project implements or runs a benchmark' },
} as const satisfies Record<string, { subject: readonly EntityKind[]; object: readonly EntityKind[]; sameKind?: boolean; description: string }>;

export type RelationPredicate = keyof typeof RELATION_RULES;
export const RELATION_PREDICATES = Object.keys(RELATION_RULES) as RelationPredicate[];

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const ok: ValidationResult = { ok: true };
const fail = (...errors: string[]): ValidationResult => ({ ok: false, errors });

export interface RelationCandidate {
  predicate: string;
  subject: { id: string; kind: EntityKind };
  object: { id: string; kind: EntityKind };
}

export function validateRelation(rel: RelationCandidate): ValidationResult {
  if (!(rel.predicate in RELATION_RULES)) return fail(`unknown predicate "${rel.predicate}"`);
  const rule: { subject: readonly EntityKind[]; object: readonly EntityKind[]; sameKind?: boolean } =
    RELATION_RULES[rel.predicate as RelationPredicate];
  const errors: string[] = [];
  if (rel.subject.id === rel.object.id) errors.push('an entity cannot relate to itself');
  if (!rule.subject.includes(rel.subject.kind)) errors.push(`${rel.predicate}: subject kind ${rel.subject.kind} not allowed`);
  if (!rule.object.includes(rel.object.kind)) errors.push(`${rel.predicate}: object kind ${rel.object.kind} not allowed`);
  if (rule.sameKind && rel.subject.kind !== rel.object.kind) errors.push(`${rel.predicate}: subject and object must be the same kind`);
  return errors.length ? fail(...errors) : ok;
}

/** Lineage predicate a derived variant kind requires. `base`/`instruct`/… from the developer need none. */
export const VARIANT_LINEAGE_REQUIREMENT: Partial<Record<VariantKind, RelationPredicate>> = {
  distill: 'distilled_from',
  fine_tune: 'fine_tuned_from',
  merge: 'merged_from',
};

export interface VariantCandidate {
  kind: VariantKind;
  developerOrgId: string;
  publisherOrgId: string;
  lineage: { predicate: RelationPredicate }[];
}

/**
 * Structural rules for a variant:
 * - derived kinds (distill / fine_tune / merge) must declare their lineage relation;
 * - a variant published by someone other than the model developer must be a derived kind,
 *   otherwise it is a re-upload and should be modelled as an artifact of the original variant.
 */
export function validateVariant(v: VariantCandidate): ValidationResult {
  const errors: string[] = [];
  const required = VARIANT_LINEAGE_REQUIREMENT[v.kind];
  if (required && !v.lineage.some((l) => l.predicate === required)) {
    errors.push(`${v.kind} variant requires a ${required} relation`);
  }
  const thirdParty = v.developerOrgId !== v.publisherOrgId;
  if (thirdParty && !required) {
    errors.push(`variant of kind ${v.kind} published by a third party must be a distill, fine_tune or merge`);
  }
  return errors.length ? fail(...errors) : ok;
}

export interface ArtifactCandidate {
  format: WeightFormat;
  scheme: { method: QuantizationMethod; format: WeightFormat; bitsPerWeight: number };
  sizeBytes: number | null;
  model: { paramsTotal: number };
}

/** An artifact's format must match its quantization scheme, and its size must be plausible for params × bpw. */
export function validateArtifact(a: ArtifactCandidate): ValidationResult {
  const errors: string[] = [];
  if (a.format !== a.scheme.format) errors.push(`artifact format ${a.format} does not match scheme format ${a.scheme.format}`);
  if (a.sizeBytes != null) {
    const expected = (a.model.paramsTotal * a.scheme.bitsPerWeight) / 8;
    const ratio = a.sizeBytes / expected;
    if (ratio < 0.7 || ratio > 1.35) {
      errors.push(`artifact size ${a.sizeBytes} implausible for ${a.model.paramsTotal} params at ${a.scheme.bitsPerWeight} bpw (ratio ${ratio.toFixed(2)})`);
    }
  }
  return errors.length ? fail(...errors) : ok;
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/\.(?=-|$)/g, '')
    .replace(/\./g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
