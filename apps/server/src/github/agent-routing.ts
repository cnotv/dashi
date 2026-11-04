import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { ticketAgentProblemOf } from '@dashi/contracts/ticket-agent'
import type { IssueLabel, TicketAgent, TicketAgentLine } from '@dashi/contracts'
import { agentSchema, targetSchema } from './agent-line.ts'

const choiceShape = {
  agent: agentSchema,
  target: targetSchema,
  model: z.string().nullable().default(null),
  reason: z.string().min(1),
}

// A rule never names a choice a start would refuse, so a proposal can always be started as shown.
const refuseUnstartableChoice = (choice: TicketAgent, context: z.RefinementCtx): void => {
  const problem = ticketAgentProblemOf(choice)
  if (problem !== null) context.addIssue({ code: 'custom', message: problem })
}

const routingRuleSchema = z
  .strictObject({ name: z.string().min(1), labels: z.array(z.string().min(1)).min(1), ...choiceShape })
  .superRefine(refuseUnstartableChoice)

const routingFallbackSchema = z.strictObject(choiceShape).superRefine(refuseUnstartableChoice)

const agentRoutingSchema = z.strictObject({ rules: z.array(routingRuleSchema), fallback: routingFallbackSchema })

/** The routing rules: the first whose labels match a ticket proposes its agent, else the fallback does. */
export type AgentRouting = z.infer<typeof agentRoutingSchema>

/**
 * Parses and validates the routing file's text.
 * @param rawJson The contents of config/agent-routing.json.
 * @returns The rules; throws, naming the field, when the text is not JSON or a rule is wrong.
 */
export const parseAgentRouting = (rawJson: string): AgentRouting => {
  const parsed = agentRoutingSchema.safeParse(JSON.parse(rawJson))
  if (!parsed.success) throw new Error(`config/agent-routing.json is not valid:\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}

/**
 * Reads and validates the routing file from disk, so a broken file stops the server at startup.
 * @param filePath The path to config/agent-routing.json.
 * @returns The rules.
 */
export const loadAgentRouting = (filePath: string): AgentRouting => parseAgentRouting(readFileSync(filePath, 'utf8'))

/**
 * Proposes an agent for a ticket that has no Agent: line, from its labels. An explicit line, and a
 * wrong one the owner must fix, are returned untouched.
 * @param line What the ticket's body says.
 * @param labels The ticket's labels.
 * @param routing The routing rules.
 * @returns The line, or the rule's choice with its reason when the line is missing.
 */
export const proposeAgentLine = (line: TicketAgentLine, labels: IssueLabel[], routing: AgentRouting): TicketAgentLine => {
  if (line.state !== 'missing') return line
  const labelNames = labels.map((label) => label.name.toLowerCase())
  const rule = routing.rules.find((candidate) => candidate.labels.some((name) => labelNames.includes(name.toLowerCase()))) ?? routing.fallback
  return { state: 'proposed', choice: { agent: rule.agent, target: rule.target, model: rule.model }, reason: rule.reason }
}
