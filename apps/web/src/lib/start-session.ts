import type { IssueLabel, StartAgent, StartOptions, StartTarget, StartWorkflow } from '@dashi/contracts'
import { openRouterModelPattern, takesOpenCode, takesOpenRouterModel } from '@dashi/contracts/open-router'
import { permissionModeOrders } from './presentation'
import type { StartChoices, StartTargetAvailability } from './types'

type ModelChoices = Pick<StartChoices, 'modelSource' | 'openRouterModel'>

const workflowByLabel: Record<string, StartWorkflow> = {
  bug: 'fix',
  documentation: 'docs',
  docs: 'docs',
  enhancement: 'feature',
  feature: 'feature',
  security: 'security',
  test: 'tests',
  tests: 'tests',
  refactor: 'refactor',
  design: 'design',
  chore: 'chore',
  dependencies: 'chore',
}

/**
 * Suggests a workflow from an issue's labels, falling back to feature.
 * @param labels The issue's labels.
 * @returns The workflow the first recognised label points at.
 */
export const suggestedWorkflowFor = (labels: IssueLabel[]): StartWorkflow =>
  labels.map((label) => workflowByLabel[label.name.toLowerCase()]).find((workflow) => workflow !== undefined) ?? 'feature'

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

/**
 * The OpenRouter model a start sends, when it runs on one.
 * @param choices What the dialog's model fields hold.
 * @param target Where the session would run; only an unattended laptop start can use OpenRouter.
 * @returns The model slug, or null for the Claude login.
 */
export const openRouterModelFor = (choices: ModelChoices, target: StartTarget): string | null =>
  isOnOpenRouter(choices, target) ? choices.openRouterModel.trim() : null

/**
 * Says what keeps a start's model choice from being sent.
 * @param choices What the dialog's model fields hold.
 * @param target Where the session would run.
 * @returns What to fix, or null when the start can go.
 */
export const startModelProblemFor = (choices: ModelChoices, target: StartTarget): string | null => {
  const openRouterModel = openRouterModelFor(choices, target)
  if (openRouterModel === null) return null
  if (openRouterModel === '') return 'Name the OpenRouter model to run on'
  return openRouterModelPattern.test(openRouterModel) ? null : 'An OpenRouter model reads like provider/model, such as openai/gpt-5-mini'
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
 * Switches a start dialog's agent, keeping the permission mode when the new agent offers it.
 * @param choices What the dialog holds.
 * @param agent The agent picked.
 * @returns The choices with the agent, and a permission mode that agent has.
 */
export const choicesWithAgent = (choices: StartChoices, agent: StartAgent): StartChoices => ({
  ...choices,
  agent,
  permissionMode: permissionModeOrders[agent].includes(choices.permissionMode) ? choices.permissionMode : 'auto',
})
