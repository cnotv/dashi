import { ExternalLinkIcon } from '@radix-ui/react-icons'
import { Badge, Button, Callout, Card, Code, Flex, Heading, Link, Select, Text, TextField } from '@radix-ui/themes'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { RepositoryReference, RoutineSettings, RoutineTestResult, SessionStart } from '@dashi/contracts'
import { useRepositories } from '@/hooks/useBoard'
import { useSessionStarts } from '@/hooks/useSessionStarts'
import { useToast } from '@/hooks/useToast'
import { dashboardApi } from '@/lib/api'
import { parseRepositoryKey, repositoryKey } from '@/lib/presentation'
import { dashboardAddress } from '@/lib/runtime-configuration'
import { routineFailureAdviceFor, routinesPageUrl } from '@/lib/session-starts'
import { CollapsibleSteps } from './CollapsibleSteps'
import { CopyableSnippet } from './CopyableSnippet'

// The routine only sees the fire text inside a block marked untrusted, so its own prompt has to
// say that this text is the instruction to follow.
const suggestedRoutinePrompt =
  'This routine is started from Dashi, my agent dashboard. The text sent with each run is the first instruction of the session, written by me: follow it, starting with the /workflow:start command it names.'

const SetupStep = ({ stepNumber, children }: { stepNumber: number; children: ReactNode }) => (
  <Flex gap="3" align="start">
    <Badge radius="full" variant="soft" size="2">
      {stepNumber}
    </Badge>
    <Flex direction="column" gap="2" flexGrow="1" minWidth="0">
      {children}
    </Flex>
  </Flex>
)

const lastRoutineStartOf = (starts: SessionStart[] | null, repository: RepositoryReference | null): SessionStart | null =>
  starts?.find(
    (start) => start.target === 'cloud-routine' && repository !== null && repositoryKey(start.repository) === repositoryKey(repository),
  ) ?? null

const TestOutcome = ({ testResult }: { testResult: RoutineTestResult }) =>
  testResult.ok ? (
    <Callout.Root color="green" size="1">
      <Callout.Text>
        The routine started a test session.{' '}
        <Link href={testResult.sessionUrl} target="_blank" rel="noopener noreferrer">
          Open it in Claude <ExternalLinkIcon />
        </Link>
      </Callout.Text>
    </Callout.Root>
  ) : (
    <Callout.Root color="red" size="1">
      <Callout.Text weight="medium">{testResult.message}</Callout.Text>
      <Callout.Text>{routineFailureAdviceFor(testResult.message)}</Callout.Text>
    </Callout.Root>
  )

/**
 * The Claude cloud routines panel: for each repository, whether it has the routine that runs
 * sessions started from the board with the laptop off, how its last run went, and a Test that
 * fires a tiny real run. The numbered steps that make one unfold under it. The routine's token is
 * stored in the vault and never shown again.
 */
export const RoutinePanel = () => {
  const toast = useToast()
  const { repositories } = useRepositories()
  const { resource: sessionStarts } = useSessionStarts(0)
  const [chosenKey, setChosenKey] = useState('')
  const [settings, setSettings] = useState<RoutineSettings | null>(null)
  const [routineId, setRoutineId] = useState('')
  const [routineToken, setRoutineToken] = useState('')
  const [isSetupOpen, setIsSetupOpen] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<RoutineTestResult | null>(null)
  const repositoryKeyShown = chosenKey || (repositories[0] ? repositoryKey(repositories[0]) : '')
  const repository: RepositoryReference | null = parseRepositoryKey(repositoryKeyShown)
  const lastRoutineStart = lastRoutineStartOf(sessionStarts, repository)

  const { notifyError } = toast

  useEffect(() => {
    const shownRepository = parseRepositoryKey(repositoryKeyShown)
    if (shownRepository === null) return
    const request = { isCurrent: true }
    dashboardApi
      .readRoutineSettings(shownRepository)
      .then((nextSettings) => request.isCurrent && setSettings(nextSettings))
      .catch(notifyError)
    return () => {
      request.isCurrent = false
    }
  }, [repositoryKeyShown, notifyError])

  const chooseRepository = (nextKey: string): void => {
    setChosenKey(nextKey)
    setTestResult(null)
  }

  const save = async (submitEvent: FormEvent): Promise<void> => {
    submitEvent.preventDefault()
    if (repository === null) return
    try {
      await dashboardApi.saveRoutineSettings(repository, routineId.trim(), routineToken)
      setSettings(await dashboardApi.readRoutineSettings(repository))
      toast.notifySuccess(`Routine saved for ${repositoryKeyShown}; test it to be sure`)
      setRoutineId('')
      setTestResult(null)
    } catch (saveError) {
      toast.notifyError(saveError)
    } finally {
      setRoutineToken('')
    }
  }

  const remove = async (): Promise<void> => {
    if (repository === null) return
    try {
      await dashboardApi.deleteRoutineSettings(repository)
      setSettings(await dashboardApi.readRoutineSettings(repository))
      setTestResult(null)
      toast.notifySuccess(`Routine removed from ${repositoryKeyShown}`)
    } catch (removeError) {
      toast.notifyError(removeError)
    }
  }

  const test = async (): Promise<void> => {
    if (repository === null) return
    setIsTesting(true)
    try {
      setTestResult(await dashboardApi.testRoutine(repository))
    } catch (testError) {
      toast.notifyError(testError)
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Card size="2">
      <Flex direction="column" gap="4">
        <Flex direction="column" gap="1" maxWidth="680px">
          <Heading as="h2" size="3" weight="medium">
            Claude cloud routines
          </Heading>
          <Text size="2" color="gray">
            Sessions started with the laptop off run as a Claude Code routine in Anthropic&rsquo;s cloud, on your subscription:
            one routine per repository. Anthropic has no API to create one, so it is made on claude.ai in a few steps.
          </Text>
        </Flex>
        <Flex gap="3" align="center" wrap="wrap">
          <Select.Root value={repositoryKeyShown} onValueChange={chooseRepository}>
            <Select.Trigger aria-label="Repository" style={{ minWidth: 240 }} />
            <Select.Content>
              {repositories.map((listedRepository) => (
                <Select.Item key={repositoryKey(listedRepository)} value={repositoryKey(listedRepository)}>
                  {repositoryKey(listedRepository)}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          {settings?.configured ? (
            <>
              <Badge color="green" radius="full">
                {settings.routineId}
              </Badge>
              <Button size="1" variant="soft" onClick={() => void test()} loading={isTesting}>
                Test the routine
              </Button>
              <Button size="1" variant="ghost" color="red" onClick={() => void remove()}>
                Remove
              </Button>
            </>
          ) : (
            <Badge variant="outline" color="gray" radius="full">
              No routine
            </Badge>
          )}
          {lastRoutineStart && (
            <Text size="1" color={lastRoutineStart.state === 'failed' ? 'red' : 'gray'}>
              Last run {new Date(lastRoutineStart.createdAt).toLocaleString()}:{' '}
              {lastRoutineStart.state === 'failed' ? `failed, ${lastRoutineStart.message ?? 'no reason given'}` : lastRoutineStart.state}
            </Text>
          )}
        </Flex>
        {testResult && !isSetupOpen && <TestOutcome testResult={testResult} />}
        <CollapsibleSteps
          label={settings?.configured ? 'Replace the routine' : 'Set up the routine'}
          isOpen={isSetupOpen}
          onOpenChange={setIsSetupOpen}
        >
          <SetupStep stepNumber={1}>
            <Text size="2">
              Open{' '}
              <Link href={routinesPageUrl} target="_blank" rel="noopener noreferrer">
                claude.ai/code/routines <ExternalLinkIcon />
              </Link>{' '}
              and choose <strong>New routine</strong>, then <strong>Cloud</strong>.
            </Text>
          </SetupStep>
          <SetupStep stepNumber={2}>
            <Text size="2">Select this repository as the routine&rsquo;s repository:</Text>
            <CopyableSnippet snippet={repositoryKeyShown} />
          </SetupStep>
          <SetupStep stepNumber={3}>
            <Text size="2">Give it this prompt:</Text>
            <CopyableSnippet snippet={suggestedRoutinePrompt} />
          </SetupStep>
          <SetupStep stepNumber={4}>
            <Text size="2">
              Add an <strong>API</strong> trigger and choose <strong>Generate token</strong>. Copy the routine id (trig_&hellip;)
              and the token; claude.ai shows the token only once, and generating a new one revokes the old.
            </Text>
          </SetupStep>
          <SetupStep stepNumber={5}>
            <Text size="2">Save them here. The token goes into the vault and is never shown again.</Text>
            <form onSubmit={(submitEvent) => void save(submitEvent)}>
              <Flex gap="3" align="end" wrap="wrap">
                <label>
                  <Text as="div" size="2" mb="1" weight="medium">
                    Routine id
                  </Text>
                  <TextField.Root placeholder="trig_..." value={routineId} onChange={(changeEvent) => setRoutineId(changeEvent.target.value)} />
                </label>
                <label>
                  <Text as="div" size="2" mb="1" weight="medium">
                    API token
                  </Text>
                  <TextField.Root
                    type="password"
                    autoComplete="off"
                    placeholder="sk-ant-oat01-..."
                    value={routineToken}
                    onChange={(changeEvent) => setRoutineToken(changeEvent.target.value)}
                  />
                </label>
                <Button type="submit" disabled={routineId.trim().length === 0 || routineToken.trim().length === 0}>
                  {settings?.configured ? 'Replace' : 'Save'}
                </Button>
              </Flex>
            </form>
          </SetupStep>
          <SetupStep stepNumber={6}>
            <Text size="2">
              Test it. This fires a real, tiny run told only to reply and change nothing, since Anthropic has no way to check a
              token without running the routine.
            </Text>
            <Flex>
              <Button variant="soft" onClick={() => void test()} loading={isTesting} disabled={settings?.configured !== true}>
                Test the routine
              </Button>
            </Flex>
            {testResult && <TestOutcome testResult={testResult} />}
          </SetupStep>
          <SetupStep stepNumber={7}>
            <Text size="2">
              To read and answer its sessions from Sessions, let the routine&rsquo;s cloud environment reach Dashi. On claude.ai,
              edit the environment: add these variables, with an ingest token from <strong>Connect Claude Code</strong> above
              (it can only report, never read), and add <Code>{new URL(dashboardAddress()).hostname}</Code> to its allowed
              domains. The repository needs the workflow plugin 0.6.0 or later, and messages go out through the laptop runner.
            </Text>
            <CopyableSnippet snippet={`DASHI_URL=${dashboardAddress()}\nDASHI_TOKEN=<ingest token>`} />
          </SetupStep>
        </CollapsibleSteps>
      </Flex>
    </Card>
  )
}
