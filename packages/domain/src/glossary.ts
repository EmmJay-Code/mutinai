/**
 * Plain-English explanations of the specialist terms the interface uses.
 *
 * Beginners should be able to read any surface without knowing the vocabulary, and experts should not have the
 * vocabulary taken away from them. So the term itself stays on the page and the explanation sits in a small
 * popover next to it (`Explain` in the web app). Every entry is one short sentence, written for someone who has
 * never run a model, and describes only what the term means — never how good something is.
 */

export interface GlossaryEntry {
  /** The term as it is written in the interface. */
  term: string;
  /** One sentence, plain language, no other jargon. */
  plain: string;
}

export const GLOSSARY = {
  'open-weights': {
    term: 'open weights',
    plain: 'The trained numbers that make up the model are published as files, so anyone can download and run it.',
  },
  parameters: {
    term: 'parameters',
    plain: 'How many numbers the model learned during training — the usual rough measure of its size.',
  },
  quantization: {
    term: 'quantization',
    plain: 'Storing each of the model’s numbers with fewer bits, so the file is smaller and needs less memory.',
  },
  vram: {
    term: 'VRAM',
    plain: 'The memory on a graphics card. A model has to fit in it to run at full speed.',
  },
  'unified-memory': {
    term: 'unified memory',
    plain: 'One pool of memory shared by the processor and graphics, as on Apple silicon, so large models can fit.',
  },
  context: {
    term: 'context',
    plain: 'How much text the model can consider at once, counted in tokens — roughly ¾ of a word each.',
  },
  moe: {
    term: 'mixture of experts',
    plain: 'A model split into parts where only a few run for each word, so it answers faster than its size suggests.',
  },
  runtime: {
    term: 'runtime',
    plain: 'The program that loads a model file and actually runs it, such as llama.cpp, Ollama, MLX or vLLM.',
  },
  'tokens-per-second': {
    term: 'tokens per second',
    plain: 'How fast the model writes its answer; about 10 tokens per second reads like comfortable typing.',
  },
  'weight-format': {
    term: 'format',
    plain: 'How a model’s files are packaged. Each program can only load certain ones, so the format decides what runs it.',
  },
  'memory-bandwidth': {
    term: 'memory speed',
    plain: 'How fast the chip can read its own memory, in GB/s. It sets how quickly a model can write its answer.',
  },
  'kv-cache': {
    term: 'working memory',
    plain: 'Extra space the model needs while it answers. It grows with the length of the conversation, on top of the file itself.',
  },
  benchmark: {
    term: 'benchmark',
    plain: 'A fixed set of questions every model is given, so their scores can be compared on the same task.',
  },
  msrp: {
    term: 'MSRP',
    plain: 'The price the manufacturer set at launch. What a shop charges today can be very different.',
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

export const glossary = (key: GlossaryKey): GlossaryEntry => GLOSSARY[key];
