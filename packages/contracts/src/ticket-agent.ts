import { claudeModelPattern, takesClaudeModel } from './claude-models.ts'
import { openRouterModelPattern, takesOpenCode, takesOpenRouterModel } from './open-router.ts'
import { opencodeModelPattern } from './opencode-models.ts'
import type { StartAgent, TicketAgent } from './types.ts'

export type TicketModelKind = 'claude' | 'opencode' | 'openrouter'

/**
 * Says which kind of model a ticket's line names, which decides where a start would send it.
 * @param agent The agent the line names.
 * @param model The line's model text.
 * @returns The kind, or null when the text matches none the agent can run.
 */
export const ticketModelKindOf = (agent: StartAgent, model: string): TicketModelKind | null => {
  if (agent === 'claude' && claudeModelPattern.test(model)) return 'claude'
  if (agent === 'opencode' && opencodeModelPattern.test(model)) return 'opencode'
  return openRouterModelPattern.test(model) ? 'openrouter' : null
}

/**
 * Says why a ticket's agent choice could not be started as written.
 * @param choice The agent, target and model.
 * @returns The problem, or null when a start would take the choice.
 */
export const ticketAgentProblemOf = ({ agent, target, model }: TicketAgent): string | null => {
  if (agent === 'opencode' && !takesOpenCode(target)) return 'OpenCode runs only unattended on the laptop, as laptop-headless'
  if (model === null) return null
  const kind = ticketModelKindOf(agent, model)
  if (kind === null) return `Unknown model "${model}" for ${agent}`
  if (kind === 'claude' && !takesClaudeModel(target)) return 'A cloud routine runs on its own model, so the line cannot name a Claude model for it'
  if (kind === 'openrouter' && !takesOpenRouterModel(target)) return 'An OpenRouter model runs only unattended on the laptop, as laptop-headless'
  return null
}
