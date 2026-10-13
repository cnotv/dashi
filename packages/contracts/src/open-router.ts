import type { StartTarget } from './types.ts'

// An OpenRouter model slug such as anthropic/claude-sonnet-4.5, meta-llama/llama-3.3-70b-instruct:free
// or ~anthropic/claude-sonnet-latest. It becomes an environment value, never an argument.
export const openRouterModelPattern = /^~?[a-z0-9][a-z0-9._-]{0,63}\/[A-Za-z0-9._:-]{1,100}$/

/**
 * Tells whether a start can run on OpenCode: only an unattended laptop start, since OpenCode has no
 * Remote Control and never runs in Claude's cloud.
 * @param target Where the session would run.
 * @returns True for an unattended laptop start.
 */
export const takesOpenCode = (target: StartTarget): boolean => target === 'laptop-headless'

/**
 * Tells whether a start can run on an OpenRouter model. Remote Control needs a claude.ai login, and
 * a cloud session runs in Anthropic's cloud, so only an unattended laptop start can.
 * @param target Where the session would run.
 * @returns True for an unattended laptop start.
 */
export const takesOpenRouterModel = (target: StartTarget): boolean => target === 'laptop-headless'
