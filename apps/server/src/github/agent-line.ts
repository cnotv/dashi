import { z } from 'zod'
import { ticketAgentProblemOf } from '@dashi/contracts/ticket-agent'
import type { TicketAgent, TicketAgentLine } from '@dashi/contracts'
import { sessionStartRequestSchema } from '../session-starts/schema.ts'

// The agent and the places to run are the ones a start accepts, so a line never names what a start would refuse.
export const agentSchema = sessionStartRequestSchema.shape.agent.unwrap()
export const targetSchema = sessionStartRequestSchema.shape.target

/** A ticket's agent choice as the write route and the line parser both check it. */
export const ticketAgentSchema = z
  .object({ agent: agentSchema, target: targetSchema, model: z.string().nullable() })
  .superRefine((choice, context) => {
    const problem = ticketAgentProblemOf(choice)
    if (problem !== null) context.addIssue({ code: 'custom', message: problem })
  })

const agentLinePattern = /^Agent:[ \t]*(.*?)[ \t]*$/m

const choiceOrProblemOf = (lineText: string): { choice: TicketAgent } | { problem: string } => {
  const [agentText, targetText, modelText, ...extraTexts] = lineText.split(/\s+/).filter((token) => token !== '')
  const agent = agentSchema.safeParse(agentText)
  if (!agent.success) {
    return { problem: `${agentText === undefined ? 'The line names no agent' : `Unknown agent "${agentText}"`}; use ${agentSchema.options.join(' or ')}` }
  }
  const target = targetSchema.safeParse(targetText)
  if (!target.success) {
    return { problem: `${targetText === undefined ? 'The line names no target' : `Unknown target "${targetText}"`}; use ${targetSchema.options.join(', ')}` }
  }
  if (extraTexts.length > 0) return { problem: `Unexpected "${extraTexts[0]}" after the model` }
  const choice = ticketAgentSchema.safeParse({ agent: agent.data, target: target.data, model: modelText ?? null })
  return choice.success ? { choice: choice.data } : { problem: choice.error.issues[0]?.message ?? 'Not a choice a start accepts' }
}

/**
 * Reads the `Agent: <agent> <target> [model]` line of an issue body, the way `Preview route:` is
 * read from a pull request body. The first such line counts.
 * @param issueBody The issue's body.
 * @returns The choice the line makes, that there is no line, or what is wrong with the line.
 */
export const parseAgentLine = (issueBody: string): TicketAgentLine => {
  const match = agentLinePattern.exec(issueBody)
  if (match === null) return { state: 'missing' }
  const outcome = choiceOrProblemOf(match[1] ?? '')
  return 'choice' in outcome ? { state: 'set', choice: outcome.choice } : { state: 'invalid', text: match[0], problem: outcome.problem }
}

const agentLineText = ({ agent, target, model }: TicketAgent): string => ['Agent:', agent, target, model].filter((part) => part !== null).join(' ')

/**
 * Puts a choice into an issue body as its Agent: line: the existing line is replaced in place,
 * and a body without one gets the line at its end. Nothing else in the body changes.
 * @param issueBody The issue's current body.
 * @param choice The agent, target and model to write.
 * @returns The new body.
 */
export const bodyWithAgentLine = (issueBody: string, choice: TicketAgent): string =>
  agentLinePattern.test(issueBody)
    ? issueBody.replace(agentLinePattern, () => agentLineText(choice))
    : issueBody.trim() === ''
      ? `${agentLineText(choice)}\n`
      : `${issueBody.trimEnd()}\n\n${agentLineText(choice)}\n`
