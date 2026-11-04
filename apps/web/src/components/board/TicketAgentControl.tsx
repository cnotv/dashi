import { Flex, Select, Text } from '@radix-ui/themes'
import type { StartAgent } from '@dashi/contracts'
import { startAgentLabels, startAgentOrder, startTargetLabels } from '@/lib/presentation'
import type { EpicViewRow } from '@/lib/types'

interface TicketAgentControlProps {
  ticket: EpicViewRow
  isSaving: boolean
  onChange: (ticket: EpicViewRow, agent: StartAgent) => void
}

/**
 * The agent a ticket's Agent: line names, with a menu to change it. The target and model show
 * beneath it; a line that is wrong shows what is wrong with it in red instead.
 */
export const TicketAgentControl = ({ ticket, isSaving, onChange }: TicketAgentControlProps) => {
  const { agentLine } = ticket
  if (ticket.state === 'closed') return null
  return (
    <Flex direction="column" gap="1" align="start">
      <Select.Root
        size="1"
        value={agentLine.state === 'set' ? agentLine.choice.agent : undefined}
        disabled={isSaving}
        onValueChange={(value) => onChange(ticket, startAgentOrder.find((agent) => agent === value) ?? 'claude')}
      >
        <Select.Trigger aria-label={`Agent for #${ticket.number}`} placeholder="Not set" variant="soft" color={agentLine.state === 'invalid' ? 'red' : undefined} />
        <Select.Content>
          {startAgentOrder.map((agent) => (
            <Select.Item key={agent} value={agent}>
              {startAgentLabels[agent]}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      {agentLine.state === 'set' && (
        <Text size="1" color="gray">
          {startTargetLabels[agentLine.choice.target].name}
          {agentLine.choice.model !== null && `, ${agentLine.choice.model}`}
        </Text>
      )}
      {agentLine.state === 'invalid' && (
        <Text size="1" color="red">
          {agentLine.problem}
        </Text>
      )}
    </Flex>
  )
}
