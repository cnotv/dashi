import type { OpenCodeModel } from './types.ts'

// An OpenCode provider model slug such as opencode/longcat-2.5-preview-free. It becomes an argument
// joined to --model=, so it is kept to a slug that can never pass for a flag of its own.
export const opencodeModelPattern = /^opencode\/[a-z0-9][a-z0-9._-]{0,63}$/

// The free models OpenCode's own provider offers, newest first, kept by hand. They run on OpenCode's
// infrastructure at no cost, without an API key. The server takes any slug the pattern allows, so a
// model missing here only needs adding to be offered.
export const openCodeModels: OpenCodeModel[] = [
  { id: 'opencode/exo-free', name: 'Exo Free' },
  { id: 'opencode/ling-3.1-flash-free', name: 'Ling 3.1 Flash Free' },
  { id: 'opencode/longcat-2.5-preview-free', name: 'LongCat 2.5 Preview Free' },
  { id: 'opencode/space-bunny-free', name: 'Space Bunny Free' },
  { id: 'opencode/mimo-v2.6-flash-free', name: 'MiMo-V2.6-Flash Free' },
  { id: 'opencode/step-5-preview-free', name: 'Step 5 Preview Free' },
  { id: 'opencode/muse-spark-1.3-contributor-free', name: 'Muse Spark 1.3 Free' },
  { id: 'opencode/nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning Free' },
  { id: 'opencode/big-pickle', name: 'Big Pickle' },
]
