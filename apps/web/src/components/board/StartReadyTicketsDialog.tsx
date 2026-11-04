import { PlayIcon } from '@radix-ui/react-icons'
import { Badge, Button, Callout, Checkbox, Dialog, Flex, Text } from '@radix-ui/themes'
import { useMemo, useState } from 'react'
import type { EpicTicket, RepositoryReference, SessionStart } from '@dashi/contracts'
import { useStartOptions } from '@/hooks/useSessionStarts'
import { dashboardApi } from '@/lib/api'
import { planEpicStarts, readyTicketsToStart, startPlannedTickets } from '@/lib/epic-start'
import { startAgentLabels, startTargetLabels } from '@/lib/presentation'
import type { EpicStartOutcome, EpicStartPlan } from '@/lib/types'

interface StartReadyTicketsDialogProps {
  repository: RepositoryReference
  tickets: EpicTicket[]
  starts: SessionStart[]
  // Called after the starts went out, so the epic reads the new starts at once.
  onStarted: () => void
}

const modelLabelOf = ({ request }: EpicStartPlan): string =>
  request.claudeModel ?? request.openRouterModel ?? request.opencodeModel ?? 'default model'

const PlanRow = ({ plan, isTicked, onTick }: { plan: EpicStartPlan; isTicked: boolean; onTick: (isTicked: boolean) => void }) => (
  <li>
    <Flex asChild gap="2" align="start">
      <label>
        <Checkbox checked={isTicked} disabled={plan.problem !== null} onCheckedChange={(checked) => onTick(checked === true)} aria-label={`Start #${plan.number}`} />
        <Flex direction="column" gap="1">
          <Text size="2">
            #{plan.number} {plan.title}
          </Text>
          <Text size="1" color="gray">
            {startAgentLabels[plan.request.agent]}, {startTargetLabels[plan.request.target].name}, {modelLabelOf(plan)}
          </Text>
          {plan.lineProblem !== null && (
            <Text size="1" color="red">
              Agent line not used: {plan.lineProblem}
            </Text>
          )}
          {plan.problem !== null && (
            <Text size="1" color="red">
              Cannot start: {plan.problem}
            </Text>
          )}
        </Flex>
      </label>
    </Flex>
  </li>
)

const OutcomeRow = ({ plan, outcome }: { plan: EpicStartPlan; outcome: EpicStartOutcome | undefined }) => (
  <li>
    <Flex gap="2" align="start" justify="between">
      <Flex direction="column" gap="1">
        <Text size="2">
          #{plan.number} {plan.title}
        </Text>
        {outcome?.message && (
          <Text size="1" color="red">
            {outcome.message}
          </Text>
        )}
      </Flex>
      <Badge color={outcome?.state === 'failed' ? 'red' : 'green'} variant="soft" radius="full">
        {outcome?.state === 'failed' ? 'Failed' : outcome?.state === 'queued' ? 'Queued' : 'Started'}
      </Badge>
    </Flex>
  </li>
)

/**
 * The epic view's one action to start every ready ticket: a confirmation lists each with its
 * agent, target and model from its Agent: line, the owner unticks any, and each ticked one goes
 * through the start API on its own; a failure is reported for its ticket and the rest still go.
 */
export const StartReadyTicketsDialog = ({ repository, tickets, starts, onStarted }: StartReadyTicketsDialogProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [untickedNumbers, setUntickedNumbers] = useState<number[]>([])
  const [outcomes, setOutcomes] = useState<EpicStartOutcome[] | null>(null)
  const [sentPlans, setSentPlans] = useState<EpicStartPlan[]>([])
  const { options, errorMessage } = useStartOptions(repository, isOpen)
  const readyTickets = useMemo(() => readyTicketsToStart(repository, tickets, starts), [repository, tickets, starts])
  const plans = useMemo(() => (options ? planEpicStarts(repository, readyTickets, options) : []), [repository, readyTickets, options])
  const tickedPlans = plans.filter((plan) => plan.problem === null && !untickedNumbers.includes(plan.number))

  const changeOpen = (nextOpen: boolean): void => {
    setIsOpen(nextOpen)
    if (!nextOpen) {
      setOutcomes(null)
      setUntickedNumbers([])
    }
  }
  const tick = (number: number, isTicked: boolean): void =>
    setUntickedNumbers((previous) => (isTicked ? previous.filter((unticked) => unticked !== number) : [...previous, number]))
  const startTicked = async (): Promise<void> => {
    setIsStarting(true)
    setSentPlans(tickedPlans)
    setOutcomes(await startPlannedTickets(tickedPlans, dashboardApi.startSession))
    setIsStarting(false)
    onStarted()
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={changeOpen}>
      <Dialog.Trigger>
        <Button size="2" disabled={readyTickets.length === 0}>
          <PlayIcon /> Start ready tickets ({readyTickets.length})
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="600px">
        <Dialog.Title>Start the ready tickets</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Each ticket starts its own session, on the agent its Agent: line names.
        </Dialog.Description>
        {outcomes !== null ? (
          <Flex direction="column" gap="4">
            <Flex asChild direction="column" gap="3">
              <ul className="start-ready-list" aria-label="Started tickets">
                {sentPlans.map((plan) => (
                  <OutcomeRow key={plan.number} plan={plan} outcome={outcomes.find((outcome) => outcome.number === plan.number)} />
                ))}
              </ul>
            </Flex>
            <Flex justify="end">
              <Dialog.Close>
                <Button>Done</Button>
              </Dialog.Close>
            </Flex>
          </Flex>
        ) : (
          <Flex direction="column" gap="4">
            {errorMessage && (
              <Callout.Root color="red" size="1">
                <Callout.Text>{errorMessage}</Callout.Text>
              </Callout.Root>
            )}
            {options === null && errorMessage === null && <Text color="gray">Reading where sessions can run</Text>}
            {options !== null && plans.length === 0 && <Text color="gray">No ticket is ready to start.</Text>}
            <Flex asChild direction="column" gap="3">
              <ul className="start-ready-list" aria-label="Ready tickets">
                {plans.map((plan) => (
                  <PlanRow key={plan.number} plan={plan} isTicked={tickedPlans.includes(plan)} onTick={(isTicked) => tick(plan.number, isTicked)} />
                ))}
              </ul>
            </Flex>
            <Flex gap="3" justify="end">
              <Dialog.Close>
                <Button type="button" variant="soft" color="gray">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button loading={isStarting} disabled={tickedPlans.length === 0} onClick={() => void startTicked()}>
                <PlayIcon /> Start {tickedPlans.length}
              </Button>
            </Flex>
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  )
}
