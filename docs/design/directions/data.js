// Shared prototype data, taken from the seeded Mutinai database (illustrative fixture values).
window.PROTO = {
  asOf: '20 May 2025',
  signals: [
    { label: 'Open models tracked', value: '17', spark: [9, 10, 11, 12, 13, 13, 15, 15, 16, 16, 17] },
    { label: 'Releases · May', value: '4', spark: [1, 1, 1, 0, 1, 2, 4, 1, 1, 1, 4] },
    { label: 'Best open GPQA', value: '71.5', unit: '%', spark: [30.4, 30.4, 49.5, 49.5, 49.5, 56.1, 71.5, 71.5, 71.5, 71.5, 71.5] },
    { label: 'Verified runs', value: '3', unit: 'of 5', spark: [0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 3] },
  ],
  months: [['Jul', 1], ['Aug', 1], ['Sep', 1], ['Oct', 0], ['Nov', 1], ['Dec', 2], ['Jan', 4], ['Feb', 1], ['Mar', 1], ['Apr', 1], ['May', 4]],
  lead: {
    kind: 'Model release',
    date: '29 Apr 2025',
    title: 'Qwen3 released with mixture-of-experts and hybrid thinking',
    deck: 'Dense and MoE models up to 235B. The 30B-A3B variant activates 3.3B parameters per token, so it runs quickly on a single consumer GPU.',
    model: { name: 'Qwen3 30B-A3B', params: '30.5B', active: '3.3B', mem: 17.9, license: 'Apache 2.0', open: true, systems: 11, of: 13, caps: ['Reasoning', 'Coding', 'Tool use'], profile: { coding: 95, reasoning: 92, knowledge: null, instruction: null } },
  },
  feed: [
    { entity: 'event', kind: 'Announcement', date: '20 May', title: 'Official Qwen3 GGUF quantizations published', about: ['Qwen3', 'llama.cpp'] },
    { entity: 'tool', kind: 'Runtime release', date: '20 May', title: 'llama.cpp b5450', about: ['llama.cpp'] },
    { entity: 'tool', kind: 'Runtime release', date: '13 May', title: 'Ollama v0.7.0 — new multimodal engine', about: ['Ollama'] },
    { entity: 'model', kind: 'Model release', date: '12 Mar', title: 'Gemma 3 released with vision and 128K context', about: ['Gemma 3'] },
    { entity: 'hardware', kind: 'Hardware launch', date: '25 Feb', title: 'Ryzen AI Max+ 395 desktops with 128 GB unified memory', about: ['Ryzen AI Max+ 395'] },
  ],
  movement: {
    benchmark: 'GPQA Diamond',
    points: [['Jul 24', 30.4, 'Llama 3.1 8B'], ['Sep 24', 49.5, 'Qwen2.5 32B'], ['Dec 24', 50.5, 'Llama 3.3 70B'], ['Dec 24', 56.1, 'Phi-4'], ['Jan 25', 71.5, 'DeepSeek-R1']],
  },
  trending: [
    { entity: 'model', name: 'Qwen3 30B-A3B', note: '2 runs · 1 review', heat: 3 },
    { entity: 'model', name: 'Qwen2.5 32B', note: '1 run · 1 review', heat: 2 },
    { entity: 'tool', name: 'llama.cpp', note: 'new build · 4 runs', heat: 3 },
    { entity: 'hardware', name: 'RTX 3090', note: '1 review · 2 runs', heat: 2 },
  ],
  community: [
    { entity: 'run', who: 'kestrel', verified: true, value: '61.5', unit: 'tok/s', what: 'Qwen3 30B-A3B · Q4_K_M', where: 'MacBook Pro M3 Max 64 GB · llama.cpp', date: '4 May' },
    { entity: 'review', who: 'tokenwright', title: 'Best local coding model I have used at 24 GB', what: 'Qwen2.5-Coder 32B', ratings: [['Coding', 5], ['Reasoning', 3], ['Agents', 3]], date: '12 Sep' },
    { entity: 'run', who: 'quietmodel', verified: false, value: '54.2', unit: 'tok/s', what: 'Qwen3 30B-A3B · MLX 4-bit', where: 'M4 Pro · 48 GB unified · MLX-LM', date: '3 May' },
  ],
  models: [
    { name: 'Qwen3 30B-A3B', dev: 'Qwen', family: 'Qwen3', released: 'Apr 2025', summary: 'MoE with hybrid thinking; fast for its size.', params: '30.5B', active: '3.3B', mem: 17.9, license: 'Apache 2.0', open: true, caps: ['Reasoning', 'Coding', 'Tool use'], profile: { coding: 95, reasoning: 92, knowledge: null, instruction: null }, reviews: 1, runs: 2, systems: 11, fresh: true },
    { name: 'Gemma 3 27B', dev: 'Google DeepMind', family: 'Gemma 3', released: 'Mar 2025', summary: 'Multimodal, 128K context.', params: '27.4B', mem: 19.3, license: 'Gemma Terms', open: false, caps: ['Vision', 'Long context'], profile: { coding: null, reasoning: 59, knowledge: 80, instruction: 98 }, reviews: 0, runs: 0, systems: 11 },
    { name: 'DeepSeek-R1 671B', dev: 'DeepSeek', family: 'DeepSeek-R1', released: 'Jan 2025', summary: 'Open reasoning model; datacenter scale.', params: '671B', active: '37B', mem: 168.4, license: 'MIT', open: true, caps: ['Reasoning', 'Coding'], profile: { coding: 100, reasoning: 100, knowledge: 100, instruction: null }, reviews: 0, runs: 0, systems: 0 },
    { name: 'Phi-4 14B', dev: 'Microsoft', family: 'Phi', released: 'Dec 2024', summary: 'Small model focused on reasoning quality.', params: '14.7B', mem: 10.0, license: 'MIT', open: true, caps: ['Reasoning', 'Coding'], profile: { coding: 89, reasoning: 78, knowledge: 84, instruction: null }, reviews: 0, runs: 0, systems: 12 },
  ],
  model: {
    name: 'Qwen2.5 32B', dev: 'Qwen Team (Alibaba Cloud)', release: 'Qwen2.5 · Sep 2024', sentence: 'A 33-billion-parameter dense model with strong coding and multilingual ability.',
    params: '32.8B', mem: 20.4, ctx: '128K', license: 'Apache 2.0', open: true, systems: 11, of: 13,
    profile: { coding: 95, reasoning: 69, knowledge: 82, instruction: null },
    bench: [['MMLU-Pro', 69.0, 84.0], ['GPQA Diamond', 49.5, 71.5], ['HumanEval', 88.4, 92.7]],
    ratings: [['Coding', 3.0, [0, 0, 1, 0, 0]], ['Reasoning', 4.0, [0, 0, 0, 1, 0]], ['Hardware efficiency', 3.0, [0, 0, 1, 0, 0]]],
    variants: [['Base', 'Qwen'], ['Instruct', 'Qwen'], ['R1 Distill', 'DeepSeek']],
    runsOn: [['RTX 4090', 'tight'], ['RTX 5090', 'full'], ['2× RTX 3090', 'full'], ['M3 Max 64 GB', 'full'], ['RTX 4060 Ti 16 GB', 'offload']],
  },
};

// Memory scale shared by prototypes: log scale from 4 to 256 GB.
window.memPos = (gb) => Math.max(0, Math.min(1, (Math.log2(gb) - 2) / 6));
