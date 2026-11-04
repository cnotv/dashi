import type { ClaudeModel, StartTarget } from './types.ts'

// What claude --model takes: an alias that follows the latest model (optionally the 1M context
// variant), or a full id such as claude-sonnet-4-5. It starts with a letter, so it is never read as
// a flag, and the runner passes it as its own argument.
export const claudeModelPattern = /^(?:(?:opus|sonnet|haiku)(?:\[1m\])?|opusplan|claude-[a-z0-9][a-z0-9._-]{0,62}(?:\[1m\])?)$/

// The aliases the start dialog offers; a full id from an Agent line still passes the pattern.
export const claudeModels: ClaudeModel[] = [
  { id: 'opus', name: 'Opus' },
  { id: 'sonnet', name: 'Sonnet' },
  { id: 'haiku', name: 'Haiku' },
]

/**
 * Tells whether a start can name a Claude model: any laptop target runs claude itself, while a
 * cloud routine runs on the model its routine is set to and the routines API cannot override it.
 * @param target Where the session would run.
 * @returns True for a laptop target.
 */
export const takesClaudeModel = (target: StartTarget): boolean => target !== 'cloud-routine'
