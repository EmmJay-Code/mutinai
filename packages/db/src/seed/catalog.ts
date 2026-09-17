/**
 * Seed catalog. Realistic, but ILLUSTRATIVE fixture data: architecture facts are drawn from public model cards,
 * benchmark and performance numbers are approximations for exercising the product, and are attributed to the
 * `mutinai-fixtures` source so they can never be mistaken for verified canonical data.
 */
import type {
  Architecture,
  BenchmarkKind,
  Capability,
  ComputeBackend,
  DeviceKind,
  EventKind,
  MemoryKind,
  OrganizationKind,
  ProjectCategory,
  QuantizationMethod,
  RelationPredicate,
  VariantKind,
  WeightFormat,
} from '@mutinai/domain';

export const licenses = [
  { key: 'apache-2.0', name: 'Apache License 2.0', spdxId: 'Apache-2.0', osiApproved: true, commercialUse: 'allowed', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
  { key: 'mit', name: 'MIT License', spdxId: 'MIT', osiApproved: true, commercialUse: 'allowed', url: 'https://opensource.org/license/mit' },
  { key: 'llama-3.1-community', name: 'Llama 3.1 Community License', spdxId: null, osiApproved: false, commercialUse: 'restricted', url: 'https://www.llama.com/llama3_1/license/' },
  { key: 'llama-3.3-community', name: 'Llama 3.3 Community License', spdxId: null, osiApproved: false, commercialUse: 'restricted', url: 'https://www.llama.com/llama3_3/license/' },
  { key: 'gemma-terms', name: 'Gemma Terms of Use', spdxId: null, osiApproved: false, commercialUse: 'restricted', url: 'https://ai.google.dev/gemma/terms' },
  { key: 'open-webui', name: 'Open WebUI License (BSD-3-Clause with branding clause)', spdxId: null, osiApproved: false, commercialUse: 'restricted', url: 'https://docs.openwebui.com/license' },
] as const satisfies readonly { key: string; name: string; spdxId: string | null; osiApproved: boolean; commercialUse: 'allowed' | 'restricted' | 'prohibited'; url: string }[];
type LicenseKey = (typeof licenses)[number]['key'];

interface OrgSeed { slug: string; name: string; orgKind: OrganizationKind; websiteUrl?: string; country?: string; summary: string }
export const organizations: OrgSeed[] = [
  { slug: 'meta', name: 'Meta', orgKind: 'ai_lab', websiteUrl: 'https://ai.meta.com', country: 'US', summary: 'Developer of the Llama model families.' },
  { slug: 'qwen', name: 'Qwen Team (Alibaba Cloud)', orgKind: 'ai_lab', websiteUrl: 'https://qwenlm.github.io', country: 'CN', summary: 'Alibaba Cloud team behind the Qwen model families.' },
  { slug: 'mistral-ai', name: 'Mistral AI', orgKind: 'ai_lab', websiteUrl: 'https://mistral.ai', country: 'FR', summary: 'Paris-based lab releasing open-weight Mistral and Mixtral models.' },
  { slug: 'google', name: 'Google DeepMind', orgKind: 'ai_lab', websiteUrl: 'https://deepmind.google', country: 'GB', summary: 'Developer of the Gemma open-weight model families.' },
  { slug: 'deepseek', name: 'DeepSeek', orgKind: 'ai_lab', websiteUrl: 'https://www.deepseek.com', country: 'CN', summary: 'Lab behind DeepSeek-V3 and the DeepSeek-R1 reasoning models.' },
  { slug: 'microsoft', name: 'Microsoft', orgKind: 'company', websiteUrl: 'https://azure.microsoft.com/products/phi', country: 'US', summary: 'Developer of the Phi small language models.' },
  { slug: 'nvidia', name: 'NVIDIA', orgKind: 'hardware_vendor', websiteUrl: 'https://www.nvidia.com', country: 'US', summary: 'GPU vendor; CUDA ecosystem.' },
  { slug: 'amd', name: 'AMD', orgKind: 'hardware_vendor', websiteUrl: 'https://www.amd.com', country: 'US', summary: 'CPU and GPU vendor; ROCm ecosystem.' },
  { slug: 'apple', name: 'Apple', orgKind: 'hardware_vendor', websiteUrl: 'https://www.apple.com', country: 'US', summary: 'Apple silicon with unified memory; maintains MLX.' },
  { slug: 'ggml-org', name: 'ggml.org', orgKind: 'community', websiteUrl: 'https://ggml.ai', summary: 'Maintainers of ggml and llama.cpp.' },
  { slug: 'ollama', name: 'Ollama', orgKind: 'company', websiteUrl: 'https://ollama.com', country: 'US', summary: 'Company behind the Ollama local model runner.' },
  { slug: 'vllm-project', name: 'vLLM Project', orgKind: 'community', websiteUrl: 'https://vllm.ai', summary: 'Community maintaining the vLLM serving engine.' },
  { slug: 'unsloth', name: 'Unsloth AI', orgKind: 'company', websiteUrl: 'https://unsloth.ai', summary: 'Fine-tuning tooling and widely used GGUF quantizations.' },
  { slug: 'lmstudio-community', name: 'LM Studio Community', orgKind: 'community', websiteUrl: 'https://huggingface.co/lmstudio-community', summary: 'Publishes GGUF quantizations of popular models.' },
  { slug: 'mlx-community', name: 'MLX Community', orgKind: 'community', websiteUrl: 'https://huggingface.co/mlx-community', summary: 'Publishes MLX conversions for Apple silicon.' },
  { slug: 'eleutherai', name: 'EleutherAI', orgKind: 'community', websiteUrl: 'https://www.eleuther.ai', summary: 'Non-profit research lab; maintains lm-evaluation-harness.' },
  { slug: 'open-webui', name: 'Open WebUI', orgKind: 'community', websiteUrl: 'https://openwebui.com', summary: 'Maintainers of the Open WebUI interface.' },
  { slug: 'axolotl-ai', name: 'Axolotl AI', orgKind: 'company', websiteUrl: 'https://axolotl.ai', summary: 'Maintainers of the Axolotl fine-tuning framework.' },
  { slug: 'berriai', name: 'BerriAI', orgKind: 'company', websiteUrl: 'https://www.litellm.ai', summary: 'Maintainers of LiteLLM.' },
  { slug: 'sgl-project', name: 'SGLang Project', orgKind: 'community', websiteUrl: 'https://sgl-project.github.io', summary: 'Community maintaining the SGLang serving framework.' },
  { slug: 'turboderp', name: 'turboderp', orgKind: 'individual', websiteUrl: 'https://github.com/turboderp', summary: 'Author of ExLlamaV2.' },
  { slug: 'continue-dev', name: 'Continue', orgKind: 'company', websiteUrl: 'https://continue.dev', summary: 'Maintainers of the Continue IDE assistant.' },
  { slug: 'aider-chat', name: 'Aider', orgKind: 'community', websiteUrl: 'https://aider.chat', summary: 'Maintainers of the Aider terminal coding assistant.' },
];

/** Organization identities in external namespaces: [namespace, value, organization slug]. */
export const organizationIdentifiers: [string, string, string][] = [
  ['huggingface-org', 'meta-llama', 'meta'], ['huggingface-org', 'Qwen', 'qwen'], ['huggingface-org', 'mistralai', 'mistral-ai'],
  ['huggingface-org', 'google', 'google'], ['huggingface-org', 'deepseek-ai', 'deepseek'], ['huggingface-org', 'microsoft', 'microsoft'],
  ['huggingface-org', 'unsloth', 'unsloth'], ['huggingface-org', 'lmstudio-community', 'lmstudio-community'], ['huggingface-org', 'mlx-community', 'mlx-community'],
  ['github-org', 'ggml-org', 'ggml-org'], ['github-org', 'ollama', 'ollama'], ['github-org', 'vllm-project', 'vllm-project'],
];

interface FamilySeed { slug: string; name: string; developer: string; parent?: string; summary: string }
export const families: FamilySeed[] = [
  { slug: 'llama', name: 'Llama', developer: 'meta', summary: 'Meta\'s open-weight LLM lineage.' },
  { slug: 'qwen', name: 'Qwen', developer: 'qwen', summary: 'Alibaba Cloud\'s general-purpose open-weight lineage.' },
  { slug: 'qwen-coder', name: 'Qwen Coder', developer: 'qwen', parent: 'qwen', summary: 'Code-specialised Qwen models, continued-pretrained on code.' },
  { slug: 'qwen-math', name: 'Qwen Math', developer: 'qwen', parent: 'qwen', summary: 'Math-specialised Qwen models.' },
  { slug: 'mistral', name: 'Mistral', developer: 'mistral-ai', summary: 'Mistral AI\'s dense open-weight models.' },
  { slug: 'mixtral', name: 'Mixtral', developer: 'mistral-ai', summary: 'Mistral AI\'s sparse mixture-of-experts models.' },
  { slug: 'gemma', name: 'Gemma', developer: 'google', summary: 'Google\'s open-weight models built from Gemini research.' },
  { slug: 'deepseek-r1', name: 'DeepSeek-R1', developer: 'deepseek', summary: 'Reasoning models trained with large-scale reinforcement learning.' },
  { slug: 'phi', name: 'Phi', developer: 'microsoft', summary: 'Microsoft\'s small language models trained heavily on synthetic data.' },
];

interface ReleaseSeed { slug: string; name: string; family: string; releasedOn: string; license: LicenseKey; announcementUrl?: string; summary: string }
export const releases: ReleaseSeed[] = [
  { slug: 'llama-3-1', name: 'Llama 3.1', family: 'llama', releasedOn: '2024-07-23', license: 'llama-3.1-community', announcementUrl: 'https://ai.meta.com/blog/meta-llama-3-1/', summary: '8B, 70B and 405B models with 128K context.' },
  { slug: 'llama-3-3', name: 'Llama 3.3', family: 'llama', releasedOn: '2024-12-06', license: 'llama-3.3-community', summary: 'A 70B instruct model with quality close to Llama 3.1 405B.' },
  { slug: 'qwen2-5', name: 'Qwen2.5', family: 'qwen', releasedOn: '2024-09-19', license: 'apache-2.0', announcementUrl: 'https://qwenlm.github.io/blog/qwen2.5/', summary: 'Dense models from 0.5B to 72B trained on 18T tokens.' },
  { slug: 'qwen2-5-coder', name: 'Qwen2.5-Coder', family: 'qwen-coder', releasedOn: '2024-11-12', license: 'apache-2.0', summary: 'Code models up to 32B.' },
  { slug: 'qwen2-5-math', name: 'Qwen2.5-Math', family: 'qwen-math', releasedOn: '2024-09-19', license: 'apache-2.0', summary: 'Math-specialised base and instruct models.' },
  { slug: 'qwen3', name: 'Qwen3', family: 'qwen', releasedOn: '2025-04-29', license: 'apache-2.0', announcementUrl: 'https://qwenlm.github.io/blog/qwen3/', summary: 'Dense and MoE models with hybrid thinking modes.' },
  { slug: 'mistral-7b-v0-3', name: 'Mistral 7B v0.3', family: 'mistral', releasedOn: '2024-05-22', license: 'apache-2.0', summary: 'Extended vocabulary and function calling support.' },
  { slug: 'mistral-small-3', name: 'Mistral Small 3', family: 'mistral', releasedOn: '2025-01-30', license: 'apache-2.0', summary: 'A latency-optimised 24B model.' },
  { slug: 'mixtral-8x7b', name: 'Mixtral 8x7B', family: 'mixtral', releasedOn: '2023-12-11', license: 'apache-2.0', summary: 'Sparse MoE with 8 experts, 2 active per token.' },
  { slug: 'gemma-2', name: 'Gemma 2', family: 'gemma', releasedOn: '2024-06-27', license: 'gemma-terms', summary: '9B and 27B models with interleaved local/global attention.' },
  { slug: 'gemma-3', name: 'Gemma 3', family: 'gemma', releasedOn: '2025-03-12', license: 'gemma-terms', summary: 'Multimodal models up to 27B with 128K context.' },
  { slug: 'deepseek-r1', name: 'DeepSeek-R1', family: 'deepseek-r1', releasedOn: '2025-01-20', license: 'mit', summary: 'Open reasoning model plus distilled dense models.' },
  { slug: 'phi-4', name: 'Phi-4', family: 'phi', releasedOn: '2024-12-12', license: 'mit', summary: 'A 14B model focused on reasoning quality.' },
];

interface ModelSeed {
  slug: string; name: string; release: string; architecture: Architecture; paramsTotal: number; paramsActive?: number;
  layers: number; attentionHeads: number; kvHeads: number; headDim: number; kvBytesPerTokenOverride?: number; contextLength: number; summary?: string;
}
export const models: ModelSeed[] = [
  { slug: 'llama-3-1-8b', name: 'Llama 3.1 8B', release: 'llama-3-1', architecture: 'dense', paramsTotal: 8_030_261_248, layers: 32, attentionHeads: 32, kvHeads: 8, headDim: 128, contextLength: 131072 },
  { slug: 'llama-3-1-70b', name: 'Llama 3.1 70B', release: 'llama-3-1', architecture: 'dense', paramsTotal: 70_553_706_496, layers: 80, attentionHeads: 64, kvHeads: 8, headDim: 128, contextLength: 131072 },
  { slug: 'llama-3-3-70b', name: 'Llama 3.3 70B', release: 'llama-3-3', architecture: 'dense', paramsTotal: 70_553_706_496, layers: 80, attentionHeads: 64, kvHeads: 8, headDim: 128, contextLength: 131072 },
  { slug: 'qwen2-5-7b', name: 'Qwen2.5 7B', release: 'qwen2-5', architecture: 'dense', paramsTotal: 7_615_616_512, layers: 28, attentionHeads: 28, kvHeads: 4, headDim: 128, contextLength: 131072 },
  { slug: 'qwen2-5-14b', name: 'Qwen2.5 14B', release: 'qwen2-5', architecture: 'dense', paramsTotal: 14_770_033_664, layers: 48, attentionHeads: 40, kvHeads: 8, headDim: 128, contextLength: 131072 },
  { slug: 'qwen2-5-32b', name: 'Qwen2.5 32B', release: 'qwen2-5', architecture: 'dense', paramsTotal: 32_763_876_352, layers: 64, attentionHeads: 40, kvHeads: 8, headDim: 128, contextLength: 131072 },
  { slug: 'qwen2-5-coder-32b', name: 'Qwen2.5-Coder 32B', release: 'qwen2-5-coder', architecture: 'dense', paramsTotal: 32_763_876_352, layers: 64, attentionHeads: 40, kvHeads: 8, headDim: 128, contextLength: 131072 },
  { slug: 'qwen2-5-math-7b', name: 'Qwen2.5-Math 7B', release: 'qwen2-5-math', architecture: 'dense', paramsTotal: 7_615_616_512, layers: 28, attentionHeads: 28, kvHeads: 4, headDim: 128, contextLength: 4096 },
  { slug: 'qwen3-30b-a3b', name: 'Qwen3 30B-A3B', release: 'qwen3', architecture: 'moe', paramsTotal: 30_532_122_624, paramsActive: 3_300_000_000, layers: 48, attentionHeads: 32, kvHeads: 4, headDim: 128, contextLength: 32768 },
  { slug: 'mistral-7b', name: 'Mistral 7B', release: 'mistral-7b-v0-3', architecture: 'dense', paramsTotal: 7_248_023_552, layers: 32, attentionHeads: 32, kvHeads: 8, headDim: 128, contextLength: 32768 },
  { slug: 'mistral-small-24b', name: 'Mistral Small 24B', release: 'mistral-small-3', architecture: 'dense', paramsTotal: 23_572_403_200, layers: 40, attentionHeads: 32, kvHeads: 8, headDim: 128, contextLength: 32768 },
  { slug: 'mixtral-8x7b', name: 'Mixtral 8x7B', release: 'mixtral-8x7b', architecture: 'moe', paramsTotal: 46_702_792_704, paramsActive: 12_900_000_000, layers: 32, attentionHeads: 32, kvHeads: 8, headDim: 128, contextLength: 32768 },
  { slug: 'gemma-2-9b', name: 'Gemma 2 9B', release: 'gemma-2', architecture: 'dense', paramsTotal: 9_241_705_984, layers: 42, attentionHeads: 16, kvHeads: 8, headDim: 256, contextLength: 8192 },
  { slug: 'gemma-2-27b', name: 'Gemma 2 27B', release: 'gemma-2', architecture: 'dense', paramsTotal: 27_227_128_320, layers: 46, attentionHeads: 32, kvHeads: 16, headDim: 128, contextLength: 8192 },
  { slug: 'gemma-3-27b', name: 'Gemma 3 27B', release: 'gemma-3', architecture: 'dense', paramsTotal: 27_432_406_640, layers: 62, attentionHeads: 32, kvHeads: 16, headDim: 128, contextLength: 131072, summary: 'KV estimate ignores sliding-window layers and overstates long-context memory.' },
  // MLA: kv_lora_rank 512 + rope dim 64 per layer, 61 layers, fp16 → 70,272 bytes/token.
  { slug: 'deepseek-r1-671b', name: 'DeepSeek-R1 671B', release: 'deepseek-r1', architecture: 'moe', paramsTotal: 671_026_419_200, paramsActive: 37_000_000_000, layers: 61, attentionHeads: 128, kvHeads: 128, headDim: 128, kvBytesPerTokenOverride: 70_272, contextLength: 163840 },
  { slug: 'phi-4-14b', name: 'Phi-4 14B', release: 'phi-4', architecture: 'dense', paramsTotal: 14_659_507_200, layers: 40, attentionHeads: 40, kvHeads: 10, headDim: 128, contextLength: 16384 },
];

type SchemeSlug = (typeof schemes)[number]['slug'];
export const schemes = [
  { slug: 'bf16', name: 'BF16', method: 'native', format: 'safetensors', bitsPerWeight: 16, summary: 'Unquantized bfloat16 weights as published.' },
  { slug: 'fp8', name: 'FP8', method: 'fp8', format: 'safetensors', bitsPerWeight: 8.1, summary: '8-bit floating point weights; native in some recent releases.' },
  { slug: 'awq-4bit', name: 'AWQ 4-bit', method: 'awq', format: 'safetensors', bitsPerWeight: 4.6, summary: 'Activation-aware 4-bit weight quantization for GPU serving.' },
  { slug: 'q8-0', name: 'Q8_0', method: 'legacy_gguf', format: 'gguf', bitsPerWeight: 8.5, summary: '8-bit GGUF; near-lossless.' },
  { slug: 'q6-k', name: 'Q6_K', method: 'k_quant', format: 'gguf', bitsPerWeight: 6.56, summary: '6-bit k-quant.' },
  { slug: 'q5-k-m', name: 'Q5_K_M', method: 'k_quant', format: 'gguf', bitsPerWeight: 5.69, summary: '5-bit k-quant, medium.', aliases: ['Q5_K'] },
  { slug: 'q4-k-m', name: 'Q4_K_M', method: 'k_quant', format: 'gguf', bitsPerWeight: 4.89, summary: 'The common default: 4-bit k-quant, medium.', aliases: ['Q4_K'] },
  { slug: 'q3-k-m', name: 'Q3_K_M', method: 'k_quant', format: 'gguf', bitsPerWeight: 3.91, summary: '3-bit k-quant; noticeable quality loss on small models.', aliases: ['Q3_K'] },
  { slug: 'iq2-xxs', name: 'IQ2_XXS', method: 'i_quant', format: 'gguf', bitsPerWeight: 2.06, summary: '2-bit importance-matrix quant for very large models.' },
  { slug: 'mlx-4bit', name: 'MLX 4-bit', method: 'mlx', format: 'mlx', bitsPerWeight: 4.5, summary: '4-bit group-quantized weights for MLX on Apple silicon.' },
  { slug: 'mlx-8bit', name: 'MLX 8-bit', method: 'mlx', format: 'mlx', bitsPerWeight: 8.5, summary: '8-bit group-quantized weights for MLX.' },
  // llama.cpp GGUF types as defined in tools/quantize/quantize.cpp and ggml/src/ggml-common.h. Bits per weight: the
  // documented figure for i-quants; otherwise the documented Llama-3-8B file size (GiB) over its 8.03B parameters, the
  // same derivation as Q4_K_M above. Unsloth Dynamic (UD-*) mixes vary per model and are deliberately not listed.
  { slug: 'q5-k-s', name: 'Q5_K_S', method: 'k_quant', format: 'gguf', bitsPerWeight: 5.57, summary: '5-bit k-quant, small.' },
  { slug: 'q4-k-s', name: 'Q4_K_S', method: 'k_quant', format: 'gguf', bitsPerWeight: 4.67, summary: '4-bit k-quant, small.' },
  { slug: 'q3-k-l', name: 'Q3_K_L', method: 'k_quant', format: 'gguf', bitsPerWeight: 4.31, summary: '3-bit k-quant, large.' },
  { slug: 'q3-k-s', name: 'Q3_K_S', method: 'k_quant', format: 'gguf', bitsPerWeight: 3.65, summary: '3-bit k-quant, small.' },
  { slug: 'q2-k', name: 'Q2_K', method: 'k_quant', format: 'gguf', bitsPerWeight: 3.17, summary: '2-bit k-quant; large quality loss.' },
  { slug: 'q5-1', name: 'Q5_1', method: 'legacy_gguf', format: 'gguf', bitsPerWeight: 6.04, summary: 'Legacy 5-bit block quant with an offset per block.' },
  { slug: 'q5-0', name: 'Q5_0', method: 'legacy_gguf', format: 'gguf', bitsPerWeight: 5.57, summary: 'Legacy 5-bit block quant.' },
  { slug: 'q4-1', name: 'Q4_1', method: 'legacy_gguf', format: 'gguf', bitsPerWeight: 5.11, summary: 'Legacy 4-bit block quant with an offset per block.' },
  { slug: 'q4-0', name: 'Q4_0', method: 'legacy_gguf', format: 'gguf', bitsPerWeight: 4.64, summary: 'Legacy 4-bit block quant.' },
  { slug: 'iq4-nl', name: 'IQ4_NL', method: 'i_quant', format: 'gguf', bitsPerWeight: 4.5, summary: '4.5-bit non-linear quant.' },
  { slug: 'iq4-xs', name: 'IQ4_XS', method: 'i_quant', format: 'gguf', bitsPerWeight: 4.25, summary: '4.25-bit non-linear quant.' },
  { slug: 'iq3-m', name: 'IQ3_M', method: 'i_quant', format: 'gguf', bitsPerWeight: 3.66, summary: '3.66-bit importance-matrix quant mix.' },
  { slug: 'iq3-s', name: 'IQ3_S', method: 'i_quant', format: 'gguf', bitsPerWeight: 3.44, summary: '3.44-bit importance-matrix quant.' },
  { slug: 'iq3-xs', name: 'IQ3_XS', method: 'i_quant', format: 'gguf', bitsPerWeight: 3.3, summary: '3.3-bit importance-matrix quant.' },
  { slug: 'iq3-xxs', name: 'IQ3_XXS', method: 'i_quant', format: 'gguf', bitsPerWeight: 3.06, summary: '3.06-bit importance-matrix quant.' },
  { slug: 'iq2-m', name: 'IQ2_M', method: 'i_quant', format: 'gguf', bitsPerWeight: 2.7, summary: '2.7-bit importance-matrix quant.' },
  { slug: 'iq2-s', name: 'IQ2_S', method: 'i_quant', format: 'gguf', bitsPerWeight: 2.5, summary: '2.5-bit importance-matrix quant.' },
  { slug: 'iq2-xs', name: 'IQ2_XS', method: 'i_quant', format: 'gguf', bitsPerWeight: 2.31, summary: '2.31-bit importance-matrix quant.' },
  { slug: 'iq1-m', name: 'IQ1_M', method: 'i_quant', format: 'gguf', bitsPerWeight: 1.75, summary: '1.75-bit importance-matrix quant for very large models.' },
  { slug: 'iq1-s', name: 'IQ1_S', method: 'i_quant', format: 'gguf', bitsPerWeight: 1.56, summary: '1.56-bit importance-matrix quant for very large models.' },
  { slug: 'gguf-bf16', name: 'GGUF BF16', method: 'native', format: 'gguf', bitsPerWeight: 16, summary: 'Unquantized bfloat16 weights in a GGUF file.' },
  { slug: 'gguf-f16', name: 'GGUF F16', method: 'native', format: 'gguf', bitsPerWeight: 16, summary: 'Unquantized float16 weights in a GGUF file.' },
] as const satisfies readonly { slug: string; name: string; method: QuantizationMethod; format: WeightFormat; bitsPerWeight: number; summary: string; aliases?: readonly string[] }[];

/** Artifact publisher defaults per scheme when not first-party. */
const quantPublisher: Partial<Record<SchemeSlug, string>> = {
  'q8-0': 'lmstudio-community', 'q6-k': 'lmstudio-community', 'q5-k-m': 'lmstudio-community', 'q4-k-m': 'lmstudio-community',
  'q3-k-m': 'unsloth', 'iq2-xxs': 'unsloth', 'mlx-4bit': 'mlx-community', 'mlx-8bit': 'mlx-community',
};

interface VariantSeed {
  slug: string; name: string; model: string; kind: VariantKind; publisher: string; capabilities: Capability[];
  hf: string; license?: LicenseKey; releasedOn?: string;
  artifacts: (SchemeSlug | { scheme: SchemeSlug; publisher: string; repo?: string })[];
  lineage?: { predicate: RelationPredicate; object: string }[];
}
export const variants: VariantSeed[] = [
  { slug: 'llama-3-1-8b-base', name: 'Llama 3.1 8B', model: 'llama-3-1-8b', kind: 'base', publisher: 'meta', capabilities: ['multilingual'], hf: 'meta-llama/Llama-3.1-8B', artifacts: ['bf16'] },
  { slug: 'llama-3-1-8b-instruct', name: 'Llama 3.1 8B Instruct', model: 'llama-3-1-8b', kind: 'instruct', publisher: 'meta', capabilities: ['chat', 'tool_use', 'multilingual', 'long_context'], hf: 'meta-llama/Llama-3.1-8B-Instruct', artifacts: ['bf16', 'q8-0', 'q4-k-m', 'mlx-4bit'] },
  { slug: 'llama-3-1-70b-instruct', name: 'Llama 3.1 70B Instruct', model: 'llama-3-1-70b', kind: 'instruct', publisher: 'meta', capabilities: ['chat', 'tool_use', 'multilingual', 'long_context'], hf: 'meta-llama/Llama-3.1-70B-Instruct', artifacts: ['bf16', 'q4-k-m', 'mlx-4bit'] },
  { slug: 'llama-3-3-70b-instruct', name: 'Llama 3.3 70B Instruct', model: 'llama-3-3-70b', kind: 'instruct', publisher: 'meta', capabilities: ['chat', 'tool_use', 'multilingual', 'long_context'], hf: 'meta-llama/Llama-3.3-70B-Instruct', artifacts: ['bf16', 'q4-k-m', 'q3-k-m', 'mlx-4bit', { scheme: 'awq-4bit', publisher: 'unsloth' }] },
  { slug: 'qwen2-5-7b-instruct', name: 'Qwen2.5 7B Instruct', model: 'qwen2-5-7b', kind: 'instruct', publisher: 'qwen', capabilities: ['chat', 'code', 'tool_use', 'multilingual', 'long_context'], hf: 'Qwen/Qwen2.5-7B-Instruct', artifacts: ['bf16', { scheme: 'q8-0', publisher: 'qwen' }, { scheme: 'q4-k-m', publisher: 'qwen' }, { scheme: 'awq-4bit', publisher: 'qwen' }, 'mlx-4bit'] },
  { slug: 'qwen2-5-14b-instruct', name: 'Qwen2.5 14B Instruct', model: 'qwen2-5-14b', kind: 'instruct', publisher: 'qwen', capabilities: ['chat', 'code', 'tool_use', 'multilingual', 'long_context'], hf: 'Qwen/Qwen2.5-14B-Instruct', artifacts: ['bf16', { scheme: 'q4-k-m', publisher: 'qwen' }, 'q6-k', { scheme: 'awq-4bit', publisher: 'qwen' }, 'mlx-4bit'] },
  { slug: 'qwen2-5-32b-base', name: 'Qwen2.5 32B', model: 'qwen2-5-32b', kind: 'base', publisher: 'qwen', capabilities: ['multilingual'], hf: 'Qwen/Qwen2.5-32B', artifacts: ['bf16'] },
  { slug: 'qwen2-5-32b-instruct', name: 'Qwen2.5 32B Instruct', model: 'qwen2-5-32b', kind: 'instruct', publisher: 'qwen', capabilities: ['chat', 'code', 'tool_use', 'multilingual', 'long_context'], hf: 'Qwen/Qwen2.5-32B-Instruct', artifacts: ['bf16', { scheme: 'q4-k-m', publisher: 'qwen' }, 'q5-k-m', { scheme: 'awq-4bit', publisher: 'qwen' }, 'mlx-4bit'] },
  { slug: 'qwen2-5-coder-32b-instruct', name: 'Qwen2.5-Coder 32B Instruct', model: 'qwen2-5-coder-32b', kind: 'coder', publisher: 'qwen', capabilities: ['chat', 'code', 'long_context'], hf: 'Qwen/Qwen2.5-Coder-32B-Instruct', artifacts: ['bf16', { scheme: 'q4-k-m', publisher: 'qwen' }, 'q8-0', 'mlx-4bit'] },
  { slug: 'qwen2-5-math-7b-base', name: 'Qwen2.5-Math 7B', model: 'qwen2-5-math-7b', kind: 'base', publisher: 'qwen', capabilities: ['reasoning'], hf: 'Qwen/Qwen2.5-Math-7B', artifacts: ['bf16'] },
  { slug: 'qwen3-30b-a3b-base', name: 'Qwen3 30B-A3B Base', model: 'qwen3-30b-a3b', kind: 'base', publisher: 'qwen', capabilities: ['multilingual'], hf: 'Qwen/Qwen3-30B-A3B-Base', artifacts: ['bf16'] },
  { slug: 'qwen3-30b-a3b', name: 'Qwen3 30B-A3B', model: 'qwen3-30b-a3b', kind: 'instruct', publisher: 'qwen', capabilities: ['chat', 'reasoning', 'code', 'tool_use', 'multilingual'], hf: 'Qwen/Qwen3-30B-A3B', artifacts: ['bf16', { scheme: 'fp8', publisher: 'qwen', repo: 'Qwen/Qwen3-30B-A3B-FP8' }, { scheme: 'q4-k-m', publisher: 'unsloth' }, 'q8-0', 'mlx-4bit', 'mlx-8bit'] },
  { slug: 'mistral-7b-instruct-v0-3', name: 'Mistral 7B Instruct v0.3', model: 'mistral-7b', kind: 'instruct', publisher: 'mistral-ai', capabilities: ['chat', 'tool_use'], hf: 'mistralai/Mistral-7B-Instruct-v0.3', artifacts: ['bf16', 'q8-0', 'q4-k-m'] },
  { slug: 'mistral-small-24b-instruct-2501', name: 'Mistral Small 24B Instruct 2501', model: 'mistral-small-24b', kind: 'instruct', publisher: 'mistral-ai', capabilities: ['chat', 'tool_use', 'multilingual'], hf: 'mistralai/Mistral-Small-24B-Instruct-2501', artifacts: ['bf16', 'q4-k-m', 'q6-k', 'mlx-4bit'] },
  { slug: 'mixtral-8x7b-instruct', name: 'Mixtral 8x7B Instruct v0.1', model: 'mixtral-8x7b', kind: 'instruct', publisher: 'mistral-ai', capabilities: ['chat', 'multilingual'], hf: 'mistralai/Mixtral-8x7B-Instruct-v0.1', artifacts: ['bf16', 'q4-k-m'] },
  { slug: 'gemma-2-9b-it', name: 'Gemma 2 9B IT', model: 'gemma-2-9b', kind: 'instruct', publisher: 'google', capabilities: ['chat'], hf: 'google/gemma-2-9b-it', artifacts: ['bf16', 'q4-k-m'] },
  { slug: 'gemma-2-27b-it', name: 'Gemma 2 27B IT', model: 'gemma-2-27b', kind: 'instruct', publisher: 'google', capabilities: ['chat'], hf: 'google/gemma-2-27b-it', artifacts: ['bf16', 'q4-k-m'] },
  { slug: 'gemma-3-27b-it', name: 'Gemma 3 27B IT', model: 'gemma-3-27b', kind: 'vision', publisher: 'google', capabilities: ['chat', 'vision', 'multilingual', 'long_context'], hf: 'google/gemma-3-27b-it', artifacts: ['bf16', 'q4-k-m', 'mlx-4bit'] },
  { slug: 'deepseek-r1', name: 'DeepSeek-R1', model: 'deepseek-r1-671b', kind: 'reasoning', publisher: 'deepseek', capabilities: ['chat', 'reasoning', 'code', 'long_context'], hf: 'deepseek-ai/DeepSeek-R1', artifacts: [{ scheme: 'fp8', publisher: 'deepseek' }, 'iq2-xxs', 'q3-k-m'] },
  {
    slug: 'deepseek-r1-distill-qwen-7b', name: 'DeepSeek-R1-Distill-Qwen-7B', model: 'qwen2-5-math-7b', kind: 'distill', publisher: 'deepseek', license: 'mit', releasedOn: '2025-01-20',
    capabilities: ['reasoning'], hf: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', artifacts: ['bf16', 'q4-k-m'],
    lineage: [{ predicate: 'distilled_from', object: 'deepseek-r1' }, { predicate: 'fine_tuned_from', object: 'qwen2-5-math-7b-base' }],
  },
  {
    slug: 'deepseek-r1-distill-qwen-32b', name: 'DeepSeek-R1-Distill-Qwen-32B', model: 'qwen2-5-32b', kind: 'distill', publisher: 'deepseek', license: 'mit', releasedOn: '2025-01-20',
    capabilities: ['reasoning', 'code'], hf: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B', artifacts: ['bf16', 'q4-k-m', 'mlx-4bit'],
    lineage: [{ predicate: 'distilled_from', object: 'deepseek-r1' }, { predicate: 'fine_tuned_from', object: 'qwen2-5-32b-base' }],
  },
  { slug: 'phi-4', name: 'Phi-4', model: 'phi-4-14b', kind: 'instruct', publisher: 'microsoft', capabilities: ['chat', 'reasoning', 'code'], hf: 'microsoft/phi-4', artifacts: ['bf16', 'q8-0', 'q4-k-m', 'mlx-4bit'] },
];

interface DeviceSeed {
  slug: string; name: string; vendor: string; deviceKind: DeviceKind; memoryKind: MemoryKind; memoryGb?: number; memoryType?: string;
  memoryBandwidthGbps?: number; unifiedUsableFraction?: number; backends: ComputeBackend[]; tdpWatts?: number; releasedOn?: string; launchPriceUsd?: number; summary: string;
}
export const devices: DeviceSeed[] = [
  { slug: 'nvidia-rtx-5090', name: 'NVIDIA GeForce RTX 5090', vendor: 'nvidia', deviceKind: 'gpu', memoryKind: 'dedicated', memoryGb: 32, memoryType: 'GDDR7', memoryBandwidthGbps: 1792, backends: ['cuda', 'vulkan'], tdpWatts: 575, releasedOn: '2025-01-30', launchPriceUsd: 1999, summary: 'Blackwell flagship with 32 GB GDDR7.' },
  { slug: 'nvidia-rtx-4090', name: 'NVIDIA GeForce RTX 4090', vendor: 'nvidia', deviceKind: 'gpu', memoryKind: 'dedicated', memoryGb: 24, memoryType: 'GDDR6X', memoryBandwidthGbps: 1008, backends: ['cuda', 'vulkan'], tdpWatts: 450, releasedOn: '2022-10-12', launchPriceUsd: 1599, summary: 'Ada Lovelace flagship; the reference local-inference GPU for years.' },
  { slug: 'nvidia-rtx-3090', name: 'NVIDIA GeForce RTX 3090', vendor: 'nvidia', deviceKind: 'gpu', memoryKind: 'dedicated', memoryGb: 24, memoryType: 'GDDR6X', memoryBandwidthGbps: 936, backends: ['cuda', 'vulkan'], tdpWatts: 350, releasedOn: '2020-09-24', launchPriceUsd: 1499, summary: 'Ampere 24 GB card; popular used for multi-GPU builds.' },
  { slug: 'nvidia-rtx-4060-ti-16gb', name: 'NVIDIA GeForce RTX 4060 Ti 16GB', vendor: 'nvidia', deviceKind: 'gpu', memoryKind: 'dedicated', memoryGb: 16, memoryType: 'GDDR6', memoryBandwidthGbps: 288, backends: ['cuda', 'vulkan'], tdpWatts: 165, releasedOn: '2023-07-18', launchPriceUsd: 499, summary: 'Budget 16 GB card with narrow memory bus.' },
  { slug: 'amd-radeon-rx-7900-xtx', name: 'AMD Radeon RX 7900 XTX', vendor: 'amd', deviceKind: 'gpu', memoryKind: 'dedicated', memoryGb: 24, memoryType: 'GDDR6', memoryBandwidthGbps: 960, backends: ['rocm', 'vulkan'], tdpWatts: 355, releasedOn: '2022-12-13', launchPriceUsd: 999, summary: 'RDNA 3 flagship with 24 GB; ROCm and Vulkan backends.' },
  { slug: 'nvidia-a100-80gb', name: 'NVIDIA A100 80GB', vendor: 'nvidia', deviceKind: 'accelerator', memoryKind: 'dedicated', memoryGb: 80, memoryType: 'HBM2e', memoryBandwidthGbps: 2039, backends: ['cuda'], tdpWatts: 400, releasedOn: '2020-11-16', summary: 'Ampere datacenter accelerator.' },
  { slug: 'apple-m3-max-40c', name: 'Apple M3 Max (40-core GPU)', vendor: 'apple', deviceKind: 'soc', memoryKind: 'unified', memoryType: 'LPDDR5', memoryBandwidthGbps: 400, backends: ['metal', 'cpu'], releasedOn: '2023-11-07', summary: 'Unified memory up to 128 GB.' },
  { slug: 'apple-m4-pro-20c', name: 'Apple M4 Pro (20-core GPU)', vendor: 'apple', deviceKind: 'soc', memoryKind: 'unified', memoryType: 'LPDDR5X', memoryBandwidthGbps: 273, backends: ['metal', 'cpu'], releasedOn: '2024-11-08', summary: 'Unified memory up to 64 GB.' },
  { slug: 'apple-m4-max-40c', name: 'Apple M4 Max (40-core GPU)', vendor: 'apple', deviceKind: 'soc', memoryKind: 'unified', memoryType: 'LPDDR5X', memoryBandwidthGbps: 546, backends: ['metal', 'cpu'], releasedOn: '2024-11-08', summary: 'Unified memory up to 128 GB.' },
  { slug: 'apple-m2-ultra-76c', name: 'Apple M2 Ultra (76-core GPU)', vendor: 'apple', deviceKind: 'soc', memoryKind: 'unified', memoryType: 'LPDDR5', memoryBandwidthGbps: 800, backends: ['metal', 'cpu'], releasedOn: '2023-06-13', summary: 'Unified memory up to 192 GB.' },
  { slug: 'amd-ryzen-ai-max-plus-395', name: 'AMD Ryzen AI Max+ 395', vendor: 'amd', deviceKind: 'soc', memoryKind: 'unified', memoryType: 'LPDDR5X-8000', memoryBandwidthGbps: 256, backends: ['vulkan', 'rocm', 'cpu'], tdpWatts: 120, releasedOn: '2025-02-25', summary: '"Strix Halo" APU with up to 128 GB unified memory.' },
  { slug: 'nvidia-gb10', name: 'NVIDIA GB10 Grace Blackwell', vendor: 'nvidia', deviceKind: 'soc', memoryKind: 'unified', memoryType: 'LPDDR5X', memoryBandwidthGbps: 273, unifiedUsableFraction: 0.9, backends: ['cuda', 'cpu'], releasedOn: '2025-10-15', summary: 'Superchip in DGX Spark-class systems; 128 GB unified memory.' },
  { slug: 'amd-ryzen-9-7950x', name: 'AMD Ryzen 9 7950X', vendor: 'amd', deviceKind: 'cpu', memoryKind: 'none', backends: ['cpu'], tdpWatts: 170, releasedOn: '2022-09-27', launchPriceUsd: 699, summary: '16-core desktop CPU; dual-channel DDR5.' },
  { slug: 'amd-epyc-7763', name: 'AMD EPYC 7763', vendor: 'amd', deviceKind: 'cpu', memoryKind: 'none', backends: ['cpu'], tdpWatts: 280, releasedOn: '2021-03-15', summary: '64-core server CPU; 8-channel DDR4.' },
];

interface ConfigSeed {
  slug: string; name: string; formFactor: string; components: { device: string; count: number }[]; systemRamGb: number;
  systemRamBandwidthGbps?: number; unifiedMemoryGb?: number; approxPriceUsd?: number; summary: string;
}
export const configurations: ConfigSeed[] = [
  { slug: 'rtx-4090-workstation', name: 'RTX 4090 workstation (64 GB DDR5)', formFactor: 'desktop', components: [{ device: 'nvidia-rtx-4090', count: 1 }, { device: 'amd-ryzen-9-7950x', count: 1 }], systemRamGb: 64, systemRamBandwidthGbps: 96, approxPriceUsd: 3200, summary: 'Single 24 GB GPU desktop.' },
  { slug: 'rtx-5090-workstation', name: 'RTX 5090 workstation (96 GB DDR5)', formFactor: 'desktop', components: [{ device: 'nvidia-rtx-5090', count: 1 }, { device: 'amd-ryzen-9-7950x', count: 1 }], systemRamGb: 96, systemRamBandwidthGbps: 96, approxPriceUsd: 4000, summary: 'Single 32 GB GPU desktop.' },
  { slug: 'dual-rtx-3090', name: 'Dual RTX 3090 (128 GB DDR5)', formFactor: 'desktop', components: [{ device: 'nvidia-rtx-3090', count: 2 }, { device: 'amd-ryzen-9-7950x', count: 1 }], systemRamGb: 128, systemRamBandwidthGbps: 83, approxPriceUsd: 3500, summary: '48 GB across two used GPUs; the classic 70B-at-home build.' },
  { slug: 'rtx-4060-ti-16gb-budget', name: 'RTX 4060 Ti 16GB budget build (32 GB DDR5)', formFactor: 'desktop', components: [{ device: 'nvidia-rtx-4060-ti-16gb', count: 1 }, { device: 'amd-ryzen-9-7950x', count: 1 }], systemRamGb: 32, systemRamBandwidthGbps: 96, approxPriceUsd: 1400, summary: 'Entry-level 16 GB GPU system.' },
  { slug: 'rx-7900-xtx-desktop', name: 'RX 7900 XTX desktop (64 GB DDR5)', formFactor: 'desktop', components: [{ device: 'amd-radeon-rx-7900-xtx', count: 1 }, { device: 'amd-ryzen-9-7950x', count: 1 }], systemRamGb: 64, systemRamBandwidthGbps: 96, approxPriceUsd: 2400, summary: 'AMD 24 GB GPU desktop on ROCm or Vulkan.' },
  { slug: 'macbook-pro-m3-max-64gb', name: 'MacBook Pro M3 Max 64 GB', formFactor: 'laptop', components: [{ device: 'apple-m3-max-40c', count: 1 }], systemRamGb: 0, unifiedMemoryGb: 64, approxPriceUsd: 4000, summary: 'Laptop with 64 GB unified memory.' },
  { slug: 'macbook-pro-m4-max-128gb', name: 'MacBook Pro M4 Max 128 GB', formFactor: 'laptop', components: [{ device: 'apple-m4-max-40c', count: 1 }], systemRamGb: 0, unifiedMemoryGb: 128, approxPriceUsd: 5400, summary: 'Laptop with 128 GB unified memory.' },
  { slug: 'mac-mini-m4-pro-48gb', name: 'Mac mini M4 Pro 48 GB', formFactor: 'mini_pc', components: [{ device: 'apple-m4-pro-20c', count: 1 }], systemRamGb: 0, unifiedMemoryGb: 48, approxPriceUsd: 1800, summary: 'Compact 48 GB unified memory desktop.' },
  { slug: 'mac-studio-m2-ultra-192gb', name: 'Mac Studio M2 Ultra 192 GB', formFactor: 'desktop', components: [{ device: 'apple-m2-ultra-76c', count: 1 }], systemRamGb: 0, unifiedMemoryGb: 192, approxPriceUsd: 6600, summary: '192 GB unified memory for very large quantized models.' },
  { slug: 'ryzen-ai-max-395-128gb', name: 'Ryzen AI Max+ 395 mini PC (128 GB)', formFactor: 'mini_pc', components: [{ device: 'amd-ryzen-ai-max-plus-395', count: 1 }], systemRamGb: 0, unifiedMemoryGb: 128, approxPriceUsd: 2000, summary: 'Strix Halo system with 128 GB unified memory.' },
  { slug: 'gb10-128gb', name: 'GB10 mini workstation (128 GB)', formFactor: 'mini_pc', components: [{ device: 'nvidia-gb10', count: 1 }], systemRamGb: 0, unifiedMemoryGb: 128, approxPriceUsd: 4000, summary: 'CUDA system with 128 GB unified memory.' },
  { slug: 'a100-80gb-server', name: 'A100 80GB server (512 GB DDR4)', formFactor: 'server', components: [{ device: 'nvidia-a100-80gb', count: 1 }, { device: 'amd-epyc-7763', count: 1 }], systemRamGb: 512, systemRamBandwidthGbps: 204, summary: 'Single datacenter GPU with large host memory.' },
  { slug: 'cpu-only-7950x-128gb', name: 'CPU-only Ryzen 9 7950X (128 GB DDR5)', formFactor: 'desktop', components: [{ device: 'amd-ryzen-9-7950x', count: 1 }], systemRamGb: 128, systemRamBandwidthGbps: 83, approxPriceUsd: 1600, summary: 'No GPU: system RAM only.' },
];

interface ProjectSeed {
  slug: string; name: string; category: ProjectCategory; maintainer?: string; license?: LicenseKey; repo: string; homepage?: string; language: string; summary: string;
  runtime?: { formats: WeightFormat[]; backends: ComputeBackend[]; supportsOffload: boolean; supportsMultiGpu: boolean; openaiCompatibleApi: boolean };
}
export const projects: ProjectSeed[] = [
  { slug: 'llama-cpp', name: 'llama.cpp', category: 'runtime', maintainer: 'ggml-org', license: 'mit', repo: 'ggml-org/llama.cpp', language: 'C++', summary: 'LLM inference in C/C++ with GGUF, broad hardware support and partial GPU offload.', runtime: { formats: ['gguf'], backends: ['cuda', 'rocm', 'metal', 'vulkan', 'cpu'], supportsOffload: true, supportsMultiGpu: true, openaiCompatibleApi: true } },
  { slug: 'ollama', name: 'Ollama', category: 'runtime', maintainer: 'ollama', license: 'mit', repo: 'ollama/ollama', homepage: 'https://ollama.com', language: 'Go', summary: 'Local model runner with a model registry and simple CLI/API.', runtime: { formats: ['gguf'], backends: ['cuda', 'rocm', 'metal', 'cpu'], supportsOffload: true, supportsMultiGpu: true, openaiCompatibleApi: true } },
  { slug: 'vllm', name: 'vLLM', category: 'runtime', maintainer: 'vllm-project', license: 'apache-2.0', repo: 'vllm-project/vllm', homepage: 'https://vllm.ai', language: 'Python', summary: 'High-throughput serving engine with PagedAttention and tensor parallelism.', runtime: { formats: ['safetensors'], backends: ['cuda', 'rocm'], supportsOffload: false, supportsMultiGpu: true, openaiCompatibleApi: true } },
  { slug: 'sglang', name: 'SGLang', category: 'runtime', maintainer: 'sgl-project', license: 'apache-2.0', repo: 'sgl-project/sglang', language: 'Python', summary: 'Fast serving framework with RadixAttention prefix caching.', runtime: { formats: ['safetensors'], backends: ['cuda', 'rocm'], supportsOffload: false, supportsMultiGpu: true, openaiCompatibleApi: true } },
  { slug: 'mlx-lm', name: 'MLX-LM', category: 'runtime', maintainer: 'apple', license: 'mit', repo: 'ml-explore/mlx-lm', language: 'Python', summary: 'Text generation and fine-tuning on Apple silicon with MLX.', runtime: { formats: ['mlx'], backends: ['metal'], supportsOffload: false, supportsMultiGpu: false, openaiCompatibleApi: true } },
  { slug: 'exllamav2', name: 'ExLlamaV2', category: 'runtime', maintainer: 'turboderp', license: 'mit', repo: 'turboderp/exllamav2', language: 'Python', summary: 'Fast CUDA inference for EXL2 and GPTQ quantized models.', runtime: { formats: ['exl2'], backends: ['cuda'], supportsOffload: false, supportsMultiGpu: true, openaiCompatibleApi: false } },
  { slug: 'open-webui', name: 'Open WebUI', category: 'ui', maintainer: 'open-webui', license: 'open-webui', repo: 'open-webui/open-webui', homepage: 'https://openwebui.com', language: 'Svelte / Python', summary: 'Self-hosted chat interface for Ollama and OpenAI-compatible APIs.' },
  { slug: 'aider', name: 'Aider', category: 'coding_assistant', maintainer: 'aider-chat', license: 'apache-2.0', repo: 'Aider-AI/aider', homepage: 'https://aider.chat', language: 'Python', summary: 'Terminal pair-programming assistant that edits files in your git repo.' },
  { slug: 'continue', name: 'Continue', category: 'coding_assistant', maintainer: 'continue-dev', license: 'apache-2.0', repo: 'continuedev/continue', homepage: 'https://continue.dev', language: 'TypeScript', summary: 'Open-source IDE assistant for VS Code and JetBrains.' },
  { slug: 'unsloth', name: 'Unsloth', category: 'fine_tuning', maintainer: 'unsloth', license: 'apache-2.0', repo: 'unslothai/unsloth', homepage: 'https://unsloth.ai', language: 'Python', summary: 'Memory-efficient fine-tuning with custom kernels.' },
  { slug: 'axolotl', name: 'Axolotl', category: 'fine_tuning', maintainer: 'axolotl-ai', license: 'apache-2.0', repo: 'axolotl-ai-cloud/axolotl', language: 'Python', summary: 'Config-driven fine-tuning framework.' },
  { slug: 'lm-evaluation-harness', name: 'lm-evaluation-harness', category: 'evaluation', maintainer: 'eleutherai', license: 'mit', repo: 'EleutherAI/lm-evaluation-harness', language: 'Python', summary: 'Framework for few-shot evaluation of language models.' },
  { slug: 'litellm', name: 'LiteLLM', category: 'gateway', maintainer: 'berriai', license: 'mit', repo: 'BerriAI/litellm', homepage: 'https://www.litellm.ai', language: 'Python', summary: 'OpenAI-compatible gateway across local and hosted model providers.' },
];

interface BenchmarkSeed { slug: string; name: string; kind: BenchmarkKind; homepage?: string; methodology?: string; summary: string; metrics: { key: string; label: string; unit: string; higherIsBetter?: boolean }[] }
export const benchmarks: BenchmarkSeed[] = [
  { slug: 'mmlu-pro', name: 'MMLU-Pro', kind: 'capability', homepage: 'https://github.com/TIGER-AI-Lab/MMLU-Pro', summary: 'Harder, 10-option successor to MMLU across 14 domains.', metrics: [{ key: 'accuracy', label: 'Accuracy', unit: '%' }] },
  { slug: 'gpqa-diamond', name: 'GPQA Diamond', kind: 'capability', homepage: 'https://github.com/idavidrein/gpqa', summary: 'Graduate-level, search-resistant science questions.', metrics: [{ key: 'accuracy', label: 'Accuracy', unit: '%' }] },
  { slug: 'humaneval', name: 'HumanEval', kind: 'capability', homepage: 'https://github.com/openai/human-eval', summary: 'Python function synthesis from docstrings.', metrics: [{ key: 'pass_at_1', label: 'pass@1', unit: '%' }] },
  { slug: 'livecodebench', name: 'LiveCodeBench', kind: 'capability', homepage: 'https://livecodebench.github.io', summary: 'Contamination-aware coding problems collected over time.', metrics: [{ key: 'pass_at_1', label: 'pass@1', unit: '%' }] },
  { slug: 'math-500', name: 'MATH-500', kind: 'capability', summary: '500-problem subset of the MATH competition benchmark.', metrics: [{ key: 'accuracy', label: 'Accuracy', unit: '%' }] },
  { slug: 'ifeval', name: 'IFEval', kind: 'capability', summary: 'Verifiable instruction-following prompts.', metrics: [{ key: 'strict_prompt', label: 'Strict prompt accuracy', unit: '%' }] },
  { slug: 'llama-bench', name: 'llama-bench', kind: 'performance', methodology: 'llama.cpp llama-bench: pp512 prompt processing and tg128 generation, batch 1.', summary: 'Standard llama.cpp throughput benchmark.', metrics: [{ key: 'pp512', label: 'Prompt processing (512)', unit: 'tok/s' }, { key: 'tg128', label: 'Generation (128)', unit: 'tok/s' }] },
  {
    slug: 'interactive-throughput', name: 'Interactive throughput', kind: 'performance', methodology: 'Single request, reported prompt and generation throughput, time to first token and peak memory.', summary: 'Runtime-agnostic single-user throughput measurement.',
    metrics: [{ key: 'prompt_tps', label: 'Prompt throughput', unit: 'tok/s' }, { key: 'gen_tps', label: 'Generation throughput', unit: 'tok/s' }, { key: 'ttft_ms', label: 'Time to first token', unit: 'ms', higherIsBetter: false }, { key: 'peak_memory_gb', label: 'Peak memory', unit: 'GB', higherIsBetter: false }],
  },
];

/** Developer-reported capability results (illustrative values). How the subject was run is structured, not prose. */
export const capabilityResults: {
  variant: string; benchmark: string; metric: string; value: number;
  config?: { label?: string; shots?: number; chainOfThought?: boolean; reasoningEnabled?: boolean };
}[] = [
  { variant: 'llama-3-1-8b-instruct', benchmark: 'mmlu-pro', metric: 'accuracy', value: 48.3, config: { label: '5-shot CoT', shots: 5, chainOfThought: true } },
  { variant: 'llama-3-1-8b-instruct', benchmark: 'gpqa-diamond', metric: 'accuracy', value: 30.4, config: { label: '0-shot', shots: 0 } },
  { variant: 'llama-3-1-8b-instruct', benchmark: 'humaneval', metric: 'pass_at_1', value: 72.6, config: { label: '0-shot', shots: 0 } },
  { variant: 'llama-3-1-8b-instruct', benchmark: 'ifeval', metric: 'strict_prompt', value: 80.4 },
  { variant: 'llama-3-1-70b-instruct', benchmark: 'mmlu-pro', metric: 'accuracy', value: 66.4, config: { label: '5-shot CoT', shots: 5, chainOfThought: true } },
  { variant: 'llama-3-1-70b-instruct', benchmark: 'humaneval', metric: 'pass_at_1', value: 80.5, config: { label: '0-shot', shots: 0 } },
  { variant: 'llama-3-3-70b-instruct', benchmark: 'mmlu-pro', metric: 'accuracy', value: 68.9, config: { label: '5-shot CoT', shots: 5, chainOfThought: true } },
  { variant: 'llama-3-3-70b-instruct', benchmark: 'gpqa-diamond', metric: 'accuracy', value: 50.5, config: { label: '0-shot CoT', shots: 0, chainOfThought: true } },
  { variant: 'llama-3-3-70b-instruct', benchmark: 'humaneval', metric: 'pass_at_1', value: 88.4, config: { label: '0-shot', shots: 0 } },
  { variant: 'llama-3-3-70b-instruct', benchmark: 'ifeval', metric: 'strict_prompt', value: 92.1 },
  { variant: 'qwen2-5-7b-instruct', benchmark: 'mmlu-pro', metric: 'accuracy', value: 56.3 },
  { variant: 'qwen2-5-7b-instruct', benchmark: 'gpqa-diamond', metric: 'accuracy', value: 36.4 },
  { variant: 'qwen2-5-7b-instruct', benchmark: 'humaneval', metric: 'pass_at_1', value: 84.8 },
  { variant: 'qwen2-5-14b-instruct', benchmark: 'mmlu-pro', metric: 'accuracy', value: 63.7 },
  { variant: 'qwen2-5-14b-instruct', benchmark: 'humaneval', metric: 'pass_at_1', value: 83.5 },
  { variant: 'qwen2-5-32b-instruct', benchmark: 'mmlu-pro', metric: 'accuracy', value: 69.0 },
  { variant: 'qwen2-5-32b-instruct', benchmark: 'gpqa-diamond', metric: 'accuracy', value: 49.5 },
  { variant: 'qwen2-5-32b-instruct', benchmark: 'humaneval', metric: 'pass_at_1', value: 88.4 },
  { variant: 'qwen2-5-coder-32b-instruct', benchmark: 'humaneval', metric: 'pass_at_1', value: 92.7 },
  { variant: 'qwen2-5-coder-32b-instruct', benchmark: 'livecodebench', metric: 'pass_at_1', value: 31.4 },
  { variant: 'qwen3-30b-a3b', benchmark: 'gpqa-diamond', metric: 'accuracy', value: 65.8, config: { label: 'thinking mode', reasoningEnabled: true } },
  { variant: 'qwen3-30b-a3b', benchmark: 'livecodebench', metric: 'pass_at_1', value: 62.6, config: { label: 'thinking mode', reasoningEnabled: true } },
  { variant: 'mistral-small-24b-instruct-2501', benchmark: 'mmlu-pro', metric: 'accuracy', value: 66.3, config: { label: '5-shot CoT', shots: 5, chainOfThought: true } },
  { variant: 'mistral-small-24b-instruct-2501', benchmark: 'humaneval', metric: 'pass_at_1', value: 84.8 },
  { variant: 'gemma-3-27b-it', benchmark: 'mmlu-pro', metric: 'accuracy', value: 67.5 },
  { variant: 'gemma-3-27b-it', benchmark: 'gpqa-diamond', metric: 'accuracy', value: 42.4 },
  { variant: 'gemma-3-27b-it', benchmark: 'ifeval', metric: 'strict_prompt', value: 90.4 },
  { variant: 'deepseek-r1', benchmark: 'mmlu-pro', metric: 'accuracy', value: 84.0 },
  { variant: 'deepseek-r1', benchmark: 'gpqa-diamond', metric: 'accuracy', value: 71.5 },
  { variant: 'deepseek-r1', benchmark: 'livecodebench', metric: 'pass_at_1', value: 65.9 },
  { variant: 'deepseek-r1', benchmark: 'math-500', metric: 'accuracy', value: 97.3 },
  { variant: 'deepseek-r1-distill-qwen-7b', benchmark: 'gpqa-diamond', metric: 'accuracy', value: 49.1 },
  { variant: 'deepseek-r1-distill-qwen-7b', benchmark: 'math-500', metric: 'accuracy', value: 92.8 },
  { variant: 'deepseek-r1-distill-qwen-32b', benchmark: 'gpqa-diamond', metric: 'accuracy', value: 62.1 },
  { variant: 'deepseek-r1-distill-qwen-32b', benchmark: 'livecodebench', metric: 'pass_at_1', value: 57.2 },
  { variant: 'deepseek-r1-distill-qwen-32b', benchmark: 'math-500', metric: 'accuracy', value: 94.3 },
  { variant: 'phi-4', benchmark: 'mmlu-pro', metric: 'accuracy', value: 70.4 },
  { variant: 'phi-4', benchmark: 'gpqa-diamond', metric: 'accuracy', value: 56.1 },
  { variant: 'phi-4', benchmark: 'humaneval', metric: 'pass_at_1', value: 82.6 },
];

/** Editorial performance measurements (illustrative). `artifact` is `<variant>--<scheme>`. */
export const performanceResults: {
  artifact: string; config: string; runtime: string; runtimeVersion: string; backend: ComputeBackend; contextLength: number;
  benchmark: 'llama-bench' | 'interactive-throughput'; values: Record<string, number>;
}[] = [
  { artifact: 'llama-3-1-8b-instruct--q4-k-m', config: 'rtx-4090-workstation', runtime: 'llama-cpp', runtimeVersion: 'b4600', backend: 'cuda', contextLength: 4096, benchmark: 'llama-bench', values: { pp512: 12100, tg128: 128 } },
  { artifact: 'llama-3-1-8b-instruct--q4-k-m', config: 'macbook-pro-m3-max-64gb', runtime: 'llama-cpp', runtimeVersion: 'b4600', backend: 'metal', contextLength: 4096, benchmark: 'llama-bench', values: { pp512: 760, tg128: 54 } },
  { artifact: 'llama-3-1-8b-instruct--q4-k-m', config: 'rx-7900-xtx-desktop', runtime: 'llama-cpp', runtimeVersion: 'b4600', backend: 'rocm', contextLength: 4096, benchmark: 'llama-bench', values: { pp512: 3050, tg128: 94 } },
  { artifact: 'llama-3-1-8b-instruct--q4-k-m', config: 'cpu-only-7950x-128gb', runtime: 'llama-cpp', runtimeVersion: 'b4600', backend: 'cpu', contextLength: 4096, benchmark: 'llama-bench', values: { pp512: 92, tg128: 12.4 } },
  { artifact: 'llama-3-3-70b-instruct--q4-k-m', config: 'dual-rtx-3090', runtime: 'llama-cpp', runtimeVersion: 'b4600', backend: 'cuda', contextLength: 4096, benchmark: 'llama-bench', values: { pp512: 390, tg128: 17.6 } },
  { artifact: 'llama-3-3-70b-instruct--q4-k-m', config: 'macbook-pro-m3-max-64gb', runtime: 'llama-cpp', runtimeVersion: 'b4600', backend: 'metal', contextLength: 4096, benchmark: 'llama-bench', values: { pp512: 72, tg128: 7.4 } },
  { artifact: 'llama-3-3-70b-instruct--q4-k-m', config: 'mac-studio-m2-ultra-192gb', runtime: 'llama-cpp', runtimeVersion: 'b4600', backend: 'metal', contextLength: 4096, benchmark: 'llama-bench', values: { pp512: 135, tg128: 12.1 } },
  { artifact: 'llama-3-3-70b-instruct--mlx-4bit', config: 'macbook-pro-m4-max-128gb', runtime: 'mlx-lm', runtimeVersion: '0.21.0', backend: 'metal', contextLength: 4096, benchmark: 'interactive-throughput', values: { prompt_tps: 110, gen_tps: 11.2, ttft_ms: 4200, peak_memory_gb: 41 } },
  { artifact: 'qwen2-5-32b-instruct--q4-k-m', config: 'rtx-5090-workstation', runtime: 'llama-cpp', runtimeVersion: 'b4600', backend: 'cuda', contextLength: 4096, benchmark: 'llama-bench', values: { pp512: 2900, tg128: 61 } },
  { artifact: 'qwen2-5-14b-instruct--q4-k-m', config: 'rtx-4060-ti-16gb-budget', runtime: 'llama-cpp', runtimeVersion: 'b4600', backend: 'cuda', contextLength: 4096, benchmark: 'llama-bench', values: { pp512: 1250, tg128: 25.5 } },
  { artifact: 'qwen3-30b-a3b--q4-k-m', config: 'rtx-4090-workstation', runtime: 'llama-cpp', runtimeVersion: 'b5300', backend: 'cuda', contextLength: 4096, benchmark: 'llama-bench', values: { pp512: 3400, tg128: 152 } },
  { artifact: 'qwen3-30b-a3b--q4-k-m', config: 'ryzen-ai-max-395-128gb', runtime: 'llama-cpp', runtimeVersion: 'b5300', backend: 'vulkan', contextLength: 4096, benchmark: 'llama-bench', values: { pp512: 420, tg128: 51 } },
  { artifact: 'qwen2-5-32b-instruct--awq-4bit', config: 'a100-80gb-server', runtime: 'vllm', runtimeVersion: '0.7.3', backend: 'cuda', contextLength: 8192, benchmark: 'interactive-throughput', values: { prompt_tps: 5200, gen_tps: 48, ttft_ms: 95, peak_memory_gb: 72 } },
];

export const relations: { subject: string; subjectKind: 'project'; predicate: RelationPredicate; object: string; objectKind: 'project' | 'benchmark' }[] = [
  { subject: 'ollama', subjectKind: 'project', predicate: 'built_on', object: 'llama-cpp', objectKind: 'project' },
  { subject: 'open-webui', subjectKind: 'project', predicate: 'integrates_with', object: 'ollama', objectKind: 'project' },
  { subject: 'aider', subjectKind: 'project', predicate: 'integrates_with', object: 'ollama', objectKind: 'project' },
  { subject: 'continue', subjectKind: 'project', predicate: 'integrates_with', object: 'ollama', objectKind: 'project' },
  { subject: 'litellm', subjectKind: 'project', predicate: 'integrates_with', object: 'vllm', objectKind: 'project' },
  { subject: 'lm-evaluation-harness', subjectKind: 'project', predicate: 'implements_benchmark', object: 'mmlu-pro', objectKind: 'benchmark' },
  { subject: 'lm-evaluation-harness', subjectKind: 'project', predicate: 'implements_benchmark', object: 'gpqa-diamond', objectKind: 'benchmark' },
  { subject: 'lm-evaluation-harness', subjectKind: 'project', predicate: 'implements_benchmark', object: 'ifeval', objectKind: 'benchmark' },
  { subject: 'llama-cpp', subjectKind: 'project', predicate: 'implements_benchmark', object: 'llama-bench', objectKind: 'benchmark' },
];

/** Cross-kind successor relations between releases/devices. */
export const successors: { kind: 'model_release' | 'hardware_device'; subject: string; object: string }[] = [
  { kind: 'model_release', subject: 'llama-3-3', object: 'llama-3-1' },
  { kind: 'model_release', subject: 'gemma-3', object: 'gemma-2' },
  { kind: 'model_release', subject: 'qwen3', object: 'qwen2-5' },
  { kind: 'hardware_device', subject: 'nvidia-rtx-5090', object: 'nvidia-rtx-4090' },
  { kind: 'hardware_device', subject: 'nvidia-rtx-4090', object: 'nvidia-rtx-3090' },
];

export const events: { kind: EventKind; title: string; occurredAt: string; url?: string; summary: string; entities: { kind: 'model_release' | 'hardware_device' | 'project' | 'organization'; slug: string }[] }[] = [
  { kind: 'model_release', title: 'Meta releases Llama 3.1 (8B, 70B, 405B)', occurredAt: '2024-07-23', summary: 'First open-weight frontier-scale Llama with 128K context.', entities: [{ kind: 'model_release', slug: 'llama-3-1' }, { kind: 'organization', slug: 'meta' }] },
  { kind: 'model_release', title: 'Qwen2.5 family released', occurredAt: '2024-09-19', summary: 'Seven dense sizes plus Coder and Math specialisations.', entities: [{ kind: 'model_release', slug: 'qwen2-5' }, { kind: 'model_release', slug: 'qwen2-5-math' }] },
  { kind: 'model_release', title: 'Qwen2.5-Coder 32B released', occurredAt: '2024-11-12', summary: 'Code model competitive with much larger closed models on HumanEval.', entities: [{ kind: 'model_release', slug: 'qwen2-5-coder' }] },
  { kind: 'model_release', title: 'Llama 3.3 70B released', occurredAt: '2024-12-06', summary: '70B instruct model approaching 405B quality.', entities: [{ kind: 'model_release', slug: 'llama-3-3' }] },
  { kind: 'model_release', title: 'Microsoft releases Phi-4', occurredAt: '2024-12-12', summary: '14B model with strong math and reasoning results.', entities: [{ kind: 'model_release', slug: 'phi-4' }] },
  { kind: 'model_release', title: 'DeepSeek-R1 and distilled models released under MIT', occurredAt: '2025-01-20', summary: 'Open reasoning model plus six distilled dense models based on Qwen and Llama.', entities: [{ kind: 'model_release', slug: 'deepseek-r1' }, { kind: 'organization', slug: 'deepseek' }] },
  { kind: 'runtime_release', title: 'vLLM V1 engine enters alpha', occurredAt: '2025-01-27', summary: 'Re-architected core engine with lower CPU overhead.', entities: [{ kind: 'project', slug: 'vllm' }] },
  { kind: 'hardware_launch', title: 'GeForce RTX 5090 launches with 32 GB GDDR7', occurredAt: '2025-01-30', summary: 'First consumer card above 24 GB of VRAM.', entities: [{ kind: 'hardware_device', slug: 'nvidia-rtx-5090' }] },
  { kind: 'model_release', title: 'Mistral Small 3 (24B) released under Apache 2.0', occurredAt: '2025-01-30', summary: 'Latency-focused 24B model.', entities: [{ kind: 'model_release', slug: 'mistral-small-3' }] },
  { kind: 'hardware_launch', title: 'Ryzen AI Max+ 395 desktops announced with 128 GB unified memory', occurredAt: '2025-02-25', summary: 'x86 unified-memory systems become a local-inference option.', entities: [{ kind: 'hardware_device', slug: 'amd-ryzen-ai-max-plus-395' }] },
  { kind: 'model_release', title: 'Gemma 3 released with vision and 128K context', occurredAt: '2025-03-12', summary: 'Sizes from 1B to 27B.', entities: [{ kind: 'model_release', slug: 'gemma-3' }] },
  { kind: 'model_release', title: 'Qwen3 released with MoE and hybrid thinking', occurredAt: '2025-04-29', summary: 'Includes the 30B-A3B MoE that runs quickly on consumer hardware.', entities: [{ kind: 'model_release', slug: 'qwen3' }] },
];
