import { Callout, Flex, Link, RadioCards, SegmentedControl, Select, Text } from '@radix-ui/themes'
import { useOpenRouterModels } from '@/hooks/useSessionStarts'
import type { StartOptions, StartTarget } from '@dashi/contracts'
import { claudeModels } from '@dashi/contracts/claude-models'
import { openCodeModels } from '@dashi/contracts/opencode-models'
import {
  permissionModeLabels,
  permissionModeOrders,
  startAgentLabels,
  startAgentOrder,
  startModelSourceLabels,
  startTargetLabels,
  startTargetOrder,
} from '@/lib/presentation'
import { agentFor, choicesWithAgent, modelSourcesFor, targetAvailabilityFor } from '@/lib/start-session'
import type { StartChoices, StartTargetAvailability } from '@/lib/types'

interface StartChoicesFieldsProps {
  choices: StartChoices
  onChange: (choices: StartChoices) => void
  options: StartOptions | null
  optionsError: string | null
  chosenTarget: StartTarget | null
  chosenAvailability: StartTargetAvailability | null
  attachmentBytes: number
  modelProblem: string | null
}

const openRouterModelsUrl = 'https://openrouter.ai/models'

// The smaller size on a phone, where three model sources side by side would push the dialog off screen.
const segmentedControlSize = { initial: '1', sm: '2' } as const

type UnattendedFieldsProps = Pick<StartChoicesFieldsProps, 'choices' | 'onChange' | 'modelProblem'>

const openRouterModelGroups = [
  { label: 'Free', isFree: true },
  { label: 'Paid', isFree: false },
]

const OpenRouterModelField = ({ choices, onChange, modelProblem }: UnattendedFieldsProps) => {
  const { models, errorMessage } = useOpenRouterModels()
  return (
    <>
      <Select.Root
        value={choices.openRouterModel}
        onValueChange={(value) => onChange({ ...choices, openRouterModel: value })}
        disabled={models === null}
      >
        <Select.Trigger aria-label="OpenRouter model" placeholder={models === null && errorMessage === null ? 'Loading models…' : 'Pick a model'} />
        <Select.Content position="popper">
          {openRouterModelGroups.map((group) => (
            <Select.Group key={group.label}>
              <Select.Label>{group.label}</Select.Label>
              {(models ?? [])
                .filter((model) => model.isFree === group.isFree)
                .map((model) => (
                  <Select.Item key={model.id} value={model.id}>
                    {model.name}
                  </Select.Item>
                ))}
            </Select.Group>
          ))}
        </Select.Content>
      </Select.Root>
      <Text size="1" color="gray">
        Runs on the laptop&apos;s own OPENROUTER_API_KEY, which the runner needs in its environment; a free model costs nothing.{' '}
        <Link href={openRouterModelsUrl} target="_blank" rel="noopener noreferrer">
          Compare models
        </Link>
      </Text>
      {errorMessage !== null && (
        <Text size="1" color="red">
          Could not load OpenRouter&apos;s models: {errorMessage}
        </Text>
      )}
      {modelProblem && (
        <Text size="1" color="red">
          {modelProblem}
        </Text>
      )}
    </>
  )
}

// A full id typed into an Agent line is not among the aliases offered, so it is listed as well, or the choice would show blank.
const ClaudeModelField = ({ choices, onChange, modelProblem }: UnattendedFieldsProps) => {
  const isListed = choices.claudeModel === '' || claudeModels.some((model) => model.id === choices.claudeModel)
  const offered = isListed ? claudeModels : [...claudeModels, { id: choices.claudeModel, name: choices.claudeModel }]
  return (
    <>
      <Select.Root value={choices.claudeModel} onValueChange={(value) => onChange({ ...choices, claudeModel: value })}>
        <Select.Trigger aria-label="Claude model" placeholder="Pick a model" />
        <Select.Content>
          {offered.map((model) => (
            <Select.Item key={model.id} value={model.id}>
              {model.name}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <Text size="1" color="gray">
        Passed to claude as --model. An alias follows the latest model of its family.
      </Text>
      {modelProblem && (
        <Text size="1" color="red">
          {modelProblem}
        </Text>
      )}
    </>
  )
}

const OpenCodeModelField = ({ choices, onChange, modelProblem }: UnattendedFieldsProps) => (
  <>
    <Select.Root
      value={choices.opencodeModel}
      onValueChange={(value) => onChange({ ...choices, opencodeModel: value })}
    >
      <Select.Trigger aria-label="OpenCode model" placeholder="Pick a model" />
      <Select.Content>
        {openCodeModels.map((model) => (
          <Select.Item key={model.id} value={model.id}>
            {model.name}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
    <Text size="1" color="gray">
      Runs on OpenCode&apos;s own provider at no cost, without an API key.
    </Text>
    {modelProblem && (
      <Text size="1" color="red">
        {modelProblem}
      </Text>
    )}
  </>
)

// What only an unattended laptop session asks: the agent that runs it, and what it may do on its own.
const UnattendedFields = ({ choices, onChange }: Pick<UnattendedFieldsProps, 'choices' | 'onChange'>) => (
  <>
    <Flex direction="column" gap="2">
      <Text size="2" weight="medium">
        Agent
      </Text>
      <SegmentedControl.Root
        aria-label="Agent"
        size={segmentedControlSize}
        value={choices.agent}
        onValueChange={(value) => onChange(choicesWithAgent(choices, startAgentOrder.find((agent) => agent === value) ?? 'claude'))}
      >
        {startAgentOrder.map((agent) => (
          <SegmentedControl.Item key={agent} value={agent}>
            {startAgentLabels[agent]}
          </SegmentedControl.Item>
        ))}
      </SegmentedControl.Root>
    </Flex>
    <label>
      <Text as="div" size="2" mb="1" weight="medium">
        Permissions
      </Text>
      <Select.Root
        value={choices.permissionMode}
        onValueChange={(value) =>
          onChange({ ...choices, permissionMode: permissionModeOrders[choices.agent].find((permissionMode) => permissionMode === value) ?? 'auto' })
        }
      >
        <Select.Trigger />
        <Select.Content>
          {permissionModeOrders[choices.agent].map((permissionMode) => (
            <Select.Item key={permissionMode} value={permissionMode}>
              {permissionModeLabels[choices.agent][permissionMode]}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </label>
  </>
)

// A cloud routine runs on the model its routine is set to, and the routines API takes no model, so it is not asked for there.
const ModelFields = ({ choices, onChange, modelProblem, target }: UnattendedFieldsProps & { target: StartTarget }) => {
  const sources = modelSourcesFor(agentFor(choices, target), target)
  const source = sources.includes(choices.modelSource) ? choices.modelSource : 'default'
  const labels = startModelSourceLabels[agentFor(choices, target)]
  if (sources.length === 0) {
    return (
      <Text size="1" color="gray">
        A cloud routine runs on the model its routine is set to. The routines API cannot change it per start, so set it in the routine itself.
      </Text>
    )
  }
  return (
    <Flex direction="column" gap="2">
      <Text size="2" weight="medium">
        Model
      </Text>
      <SegmentedControl.Root
        aria-label="Model"
        size={segmentedControlSize}
        value={source}
        onValueChange={(value) => onChange({ ...choices, modelSource: sources.find((candidate) => candidate === value) ?? 'default' })}
      >
        {sources.map((candidate) => (
          <SegmentedControl.Item key={candidate} value={candidate}>
            {labels[candidate]}
          </SegmentedControl.Item>
        ))}
      </SegmentedControl.Root>
      {source === 'claude' && <ClaudeModelField choices={choices} onChange={onChange} modelProblem={modelProblem} />}
      {source === 'openrouter' && <OpenRouterModelField choices={choices} onChange={onChange} modelProblem={modelProblem} />}
      {source === 'opencode' && <OpenCodeModelField choices={choices} onChange={onChange} modelProblem={modelProblem} />}
    </Flex>
  )
}

/**
 * The choices every start dialog asks for: where the session runs, for an unattended laptop session
 * the agent and its permission mode, and the model a Claude Code session or an unattended one runs on. The workflow is the session's
 * own pick.
 */
export const StartChoicesFields = ({
  choices,
  onChange,
  options,
  optionsError,
  chosenTarget,
  chosenAvailability,
  attachmentBytes,
  modelProblem,
}: StartChoicesFieldsProps) => (
  <>
    <Flex direction="column" gap="1">
      <Text size="2" weight="medium">
        Where it runs
      </Text>
      {optionsError && (
        <Callout.Root color="red" size="1">
          <Callout.Text>{optionsError}</Callout.Text>
        </Callout.Root>
      )}
      <RadioCards.Root
        value={chosenTarget ?? undefined}
        onValueChange={(value) => onChange({ ...choices, target: startTargetOrder.find((target) => target === value) ?? null })}
        columns={{ initial: '1', sm: '2' }}
      >
        {startTargetOrder.map((target) => {
          const availability = options ? targetAvailabilityFor(target, options, attachmentBytes) : { isAvailable: false, hint: null }
          return (
            <RadioCards.Item key={target} value={target} disabled={!availability.isAvailable}>
              <Flex direction="column" gap="1" width="100%">
                <Text size="2" weight="medium">
                  {startTargetLabels[target].name}
                </Text>
                <Text size="1" color="gray">
                  {availability.isAvailable ? startTargetLabels[target].description : availability.hint}
                </Text>
              </Flex>
            </RadioCards.Item>
          )
        })}
      </RadioCards.Root>
      {chosenAvailability?.hint && (
        <Text size="1" color={chosenAvailability.isAvailable ? 'amber' : 'red'}>
          {chosenAvailability.hint}
        </Text>
      )}
    </Flex>
    {chosenTarget === 'laptop-headless' && <UnattendedFields choices={choices} onChange={onChange} />}
    {chosenTarget !== null && <ModelFields choices={choices} onChange={onChange} modelProblem={modelProblem} target={chosenTarget} />}
  </>
)
