import type { StartAgent, StartOptions, StartTarget, TicketAgent, TicketAgentLine } from '@dashi/contracts'
import { claudeModelPattern, takesClaudeModel } from '@dashi/contracts/claude-models'
import { openRouterModelPattern, takesOpenCode, takesOpenRouterModel } from '@dashi/contracts/open-router'
import { opencodeModelPattern } from '@dashi/contracts/opencode-models'
import { ticketModelKindOf } from '@dashi/contracts/ticket-agent'
import { permissionModeOrders, startModelSourceOrders } from './presentation'
import type { StartChoices, StartModelSource, StartTargetAvailability } from './types'

type ModelChoices = Pick<StartChoices, 'agent' | 'modelSource' | 'openRouterModel' | 'opencodeModel' | 'claudeModel'>

/**
 * Tells whether a session takes attachments as files on the laptop, or only as text in its prompt.
 * @param target Where the session would run.
 * @returns True for the laptop sessions that read files.
 */
export const takesAttachmentFiles = (target: StartTarget): boolean => target === 'laptop-remote-control' || target === 'laptop-headless'

/**
 * Says whether a place to run can take a start now, and what the person should know about it.
 * @param target Where the session would run.
 * @param options The runners seen, whether the repository has a routine, and the attachment limits.
 * @param attachmentBytes The size of the files attached to the start.
 * @returns Whether it can be picked, and a hint when something is missing or late.
 */
export const targetAvailabilityFor = (target: StartTarget, options: StartOptions, attachmentBytes: number): StartTargetAvailability => {
  const allowedBytes = takesAttachmentFiles(target) ? options.attachmentLimits.fileTargetBytes : options.attachmentLimits.inlineTargetBytes
  if (attachmentBytes > allowedBytes) {
    return { isAvailable: false, hint: `Takes at most ${Math.floor(allowedBytes / 1024)} KB of attachments` }
  }
  if (target === 'cloud-routine') {
    return options.routineConfigured
      ? { isAvailable: true, hint: null }
      : { isAvailable: false, hint: 'Set up a routine for this repository under Credentials' }
  }
  if (options.runners.length === 0) return { isAvailable: false, hint: 'Set up the laptop runner under Credentials' }
  return options.runners.some((runner) => runner.isOnline)
    ? { isAvailable: true, hint: null }
    : { isAvailable: true, hint: 'No runner is online; the start waits until the laptop runner next asks' }
}

/**
 * Picks where a start runs by default: the laptop when its runner is online, the routine when
 * there is one, the laptop otherwise.
 * @param options The runners seen and whether the repository has a routine.
 * @returns The default place to run.
 */
export const defaultTargetFor = (options: StartOptions): StartTarget => {
  if (options.runners.some((runner) => runner.isOnline)) return 'laptop-remote-control'
  return options.routineConfigured ? 'cloud-routine' : 'laptop-remote-control'
}

const isOnOpenRouter = (choices: ModelChoices, target: StartTarget): boolean => choices.modelSource === 'openrouter' && takesOpenRouterModel(target)

// Only OpenCode itself can run on its provider's models; Claude Code would ignore one and run on its login.
const isOnOpenCodeModel = (choices: ModelChoices, target: StartTarget): boolean =>
  choices.modelSource === 'opencode' && choices.agent === 'opencode' && takesOpenCode(target)

/**
 * The model sources a start can run on at a place: Claude Code on any laptop can run a Claude model,
 * an unattended start can also run on OpenRouter (and OpenCode its own provider), and a cloud routine
 * runs on whatever its routine is set to.
 * @param agent The agent picked.
 * @param target Where the session would run.
 * @returns The sources to offer, none for a cloud routine.
 */
export const modelSourcesFor = (agent: StartAgent, target: StartTarget): StartModelSource[] => {
  if (target === 'laptop-headless') return startModelSourceOrders[agent]
  return takesClaudeModel(target) ? ['default', 'claude'] : []
}

/**
 * The Claude model a start sends, when it runs on one.
 * @param choices What the dialog's model fields hold.
 * @param target Where the session would run; a cloud routine cannot take a model.
 * @returns The alias or id, or null for the login's default.
 */
export const claudeModelFor = (choices: ModelChoices, target: StartTarget): string | null =>
  choices.modelSource === 'claude' && agentFor(choices, target) === 'claude' && takesClaudeModel(target) ? choices.claudeModel : null

/**
 * The OpenRouter model a start sends, when it runs on one.
 * @param choices What the dialog's model fields hold.
 * @param target Where the session would run; only an unattended laptop start can use OpenRouter.
 * @returns The model slug, or null for the Claude login.
 */
export const openRouterModelFor = (choices: ModelChoices, target: StartTarget): string | null =>
  isOnOpenRouter(choices, target) ? choices.openRouterModel : null

/**
 * The OpenCode provider model a start sends, when it runs on one.
 * @param choices What the dialog's model fields hold.
 * @param target Where the session would run; only an unattended OpenCode start can use an OpenCode model.
 * @returns The model slug, or null for OpenCode's default.
 */
export const opencodeModelFor = (choices: ModelChoices, target: StartTarget): string | null =>
  isOnOpenCodeModel(choices, target) ? choices.opencodeModel : null

/**
 * Says what keeps a start's model choice from being sent.
 * @param choices What the dialog's model fields hold.
 * @param target Where the session would run.
 * @returns What to fix, or null when the start can go.
 */
export const startModelProblemFor = (choices: ModelChoices, target: StartTarget): string | null => {
  const claudeModel = claudeModelFor(choices, target)
  if (claudeModel !== null) {
    if (claudeModel === '') return 'Pick a Claude model to run on'
    return claudeModelPattern.test(claudeModel) ? null : 'A Claude model is an alias such as opus, sonnet or haiku, or a full id such as claude-sonnet-4-5'
  }
  const openRouterModel = openRouterModelFor(choices, target)
  if (openRouterModel !== null) {
    if (openRouterModel === '') return 'Pick an OpenRouter model to run on'
    return openRouterModelPattern.test(openRouterModel) ? null : 'An OpenRouter model reads like provider/model, such as openai/gpt-5-mini'
  }
  const opencodeModel = opencodeModelFor(choices, target)
  if (opencodeModel !== null) {
    if (opencodeModel === '') return 'Pick an OpenCode model to run on'
    return opencodeModelPattern.test(opencodeModel) ? null : 'An OpenCode model reads like opencode/model, such as opencode/longcat-2.5-preview-free'
  }
  return null
}

/**
 * The agent a start runs: OpenCode when it was picked and the place can run it, else Claude Code.
 * @param choices What the dialog's agent field holds.
 * @param choices.agent The agent picked.
 * @param target Where the session would run; only an unattended laptop start can run OpenCode.
 * @returns The agent to send.
 */
export const agentFor = ({ agent }: Pick<StartChoices, 'agent'>, target: StartTarget): StartAgent =>
  agent === 'opencode' && takesOpenCode(target) ? 'opencode' : 'claude'

/**
 * Switches a start dialog's agent, keeping the permission mode and model source when the new agent offers them.
 * @param choices What the dialog holds.
 * @param agent The agent picked.
 * @returns The choices with the agent, and a permission mode and model source that agent has.
 */
export const choicesWithAgent = (choices: StartChoices, agent: StartAgent): StartChoices => ({
  ...choices,
  agent,
  permissionMode: permissionModeOrders[agent].includes(choices.permissionMode) ? choices.permissionMode : 'auto',
  modelSource: startModelSourceOrders[agent].includes(choices.modelSource) ? choices.modelSource : 'default',
})

/**
 * The choice a ticket's Agent: line makes, or the routing file proposes when it has none.
 * @param line What the ticket's body says.
 * @returns The agent, target and model, or null for a wrong line or a ticket nothing proposes for.
 */
export const ticketAgentOf = (line: TicketAgentLine): TicketAgent | null => (line.state === 'set' || line.state === 'proposed' ? line.choice : null)

/**
 * What a Start dialog holds when it opens: the ticket's agent, target and model when its line
 * names them, the dialog's own defaults otherwise. All of it can still be changed.
 * @param choice The ticket's choice, or null when it has none.
 * @returns The dialog's choices.
 */
export const choicesFromTicketAgent = (choice: TicketAgent | null): StartChoices => {
  const defaults: StartChoices = {
    target: null,
    agent: 'claude',
    permissionMode: 'auto',
    modelSource: 'default',
    openRouterModel: '',
    opencodeModel: '',
    claudeModel: '',
  }
  if (choice === null) return defaults
  const model = choice.model ?? ''
  const modelKind = choice.model === null ? null : ticketModelKindOf(choice.agent, choice.model)
  return {
    ...defaults,
    target: choice.target,
    agent: choice.agent,
    modelSource: modelKind ?? 'default',
    openRouterModel: modelKind === 'openrouter' ? model : '',
    opencodeModel: modelKind === 'opencode' ? model : '',
    claudeModel: modelKind === 'claude' ? model : '',
  }
}

/**
 * The choice to write back to a ticket when its agent is changed: the target stays where the new
 * agent can run there, and so does the model while the new agent can run it.
 * @param line What the ticket's body says now.
 * @param agent The agent picked.
 * @returns The agent, target and model for the new line.
 */
export const ticketAgentAfterAgentChange = (line: TicketAgentLine, agent: StartAgent): TicketAgent => {
  const current = ticketAgentOf(line)
  const target = current !== null && (agent === 'claude' || takesOpenCode(current.target)) ? current.target : 'laptop-headless'
  const currentModel = current?.model ?? null
  return { agent, target, model: currentModel !== null && ticketModelKindOf(agent, currentModel) !== null ? currentModel : null }
}
