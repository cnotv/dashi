import { Badge, Button, Card, Dialog, Flex, Heading, SegmentedControl, Table, Tabs, Text, TextField } from '@radix-ui/themes'
import { useState, type FormEvent } from 'react'
import type { MachinePlatform, ServedScriptInfo } from '@dashi/contracts'
import { useMachineTokens } from '@/hooks/useActivity'
import { usePolledResource } from '@/hooks/usePolledResource'
import { CredentialGuideDetails } from './CredentialGuideDetails'
import { CopyableSnippet } from './CopyableSnippet'
import { ServedScriptSource } from './ServedScriptSource'
import { machineGuides } from '@/lib/credential-guides'
import { useToast } from '@/hooks/useToast'
import { dashboardApi } from '@/lib/api'
import { dashboardAddress } from '@/lib/runtime-configuration'
import { platformLabels, platformOfUserAgent } from '@/lib/machine-setup'
import { runnerLaunchAgentCommands, runnerReviewCommands, runnerSystemdCommands, runnerTryCommands } from '@/lib/runner-setup'

const tmuxInstallOf: Record<MachinePlatform, string> = { macos: 'brew install tmux', linux: 'sudo apt install tmux' }

// What the runner does, said plainly, so it can be checked against the source before it is installed.
const runnerDoesList = [
  'Asks this dashboard for work every few seconds; the dashboard never connects to the laptop.',
  'Clones the repository of a start with your own git credentials, under ~/dashi, and starts Claude Code in a fresh worktree there.',
  'Reads the transcript of a session it started only while that session’s chat drawer is open here, and types the messages sent from it.',
  'Runs every command as an argument list, never a shell string, and only for a repository listed in this dashboard.',
  'Holds a runner token that can only take and report starts; Revoke below cuts it off.',
]

const RunnerSource = ({ scriptInfo, platform }: { scriptInfo: ServedScriptInfo | null; platform: MachinePlatform }) => (
  <ServedScriptSource
    scriptName="The runner"
    scriptInfo={scriptInfo}
    sourcePath="apps/runner/src/runner.ts"
    doesList={runnerDoesList}
    reviewSnippet={scriptInfo && runnerReviewCommands({ dashboardUrl: dashboardAddress(), scriptSha256: scriptInfo.sha256, platform })}
  />
)

const InstallCommands = ({ runnerToken, scriptInfo, platform }: { runnerToken: string; scriptInfo: ServedScriptInfo; platform: MachinePlatform }) => {
  const setupInput = { dashboardUrl: dashboardAddress(), runnerToken, scriptSha256: scriptInfo.sha256, platform }
  return (
    <Tabs.Root defaultValue="service">
      <Tabs.List>
        <Tabs.Trigger value="service">{platform === 'macos' ? 'Start with the Mac' : 'Start with the session'}</Tabs.Trigger>
        <Tabs.Trigger value="try">Try it once</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="service">
        {platform === 'macos' ? (
          <Text as="p" size="2" color="gray" my="2">
            Installs it as a login agent that starts with the Mac and restarts if it stops. Its log is ~/dashi/runner.log. Run it in
            Terminal on the Mac itself: launchd starts login agents only inside a GUI login, not over SSH.
          </Text>
        ) : (
          <Text as="p" size="2" color="gray" my="2">
            Installs it as a systemd user service that starts with your session and restarts if it stops; the token goes in
            ~/dashi/runner.env, readable by you only. Its log is journalctl --user -u dashi-runner. To keep it running after
            you log out, run loginctl enable-linger $USER once.
          </Text>
        )}
        <CopyableSnippet snippet={platform === 'macos' ? runnerLaunchAgentCommands(setupInput) : runnerSystemdCommands(setupInput)} />
      </Tabs.Content>
      <Tabs.Content value="try">
        <Text as="p" size="2" color="gray" my="2">
          Runs it in this terminal until you close it.
        </Text>
        <CopyableSnippet snippet={runnerTryCommands(setupInput)} />
      </Tabs.Content>
    </Tabs.Root>
  )
}

/**
 * The Laptop runner panel: says where the runner comes from and what it does, issues a runner
 * token, shows it once inside commands for macOS or Linux that check the runner's hash before
 * installing it, and lists runners with when each last asked for work.
 */
export const RunnerPanel = () => {
  const toast = useToast()
  const { machineTokens: runnerTokens, createMachineToken, revokeMachineToken } = useMachineTokens('runner', toast.notifyError)
  const [isOpen, setIsOpen] = useState(false)
  const [runnerLabel, setRunnerLabel] = useState('')
  const [runnerToken, setRunnerToken] = useState<string | null>(null)
  const [platform, setPlatform] = useState<MachinePlatform>(() => platformOfUserAgent(navigator.userAgent))
  const { resource: scriptInfo } = usePolledResource(`runner-script-info-${isOpen}`, () => dashboardApi.readRunnerScriptInfo(), null)

  const closeDialog = (nextOpen: boolean): void => {
    setIsOpen(nextOpen)
    if (!nextOpen) {
      setRunnerToken(null)
      setRunnerLabel('')
    }
  }

  const create = async (submitEvent: FormEvent): Promise<void> => {
    submitEvent.preventDefault()
    try {
      setRunnerToken((await createMachineToken(runnerLabel)).token)
    } catch (createError) {
      toast.notifyError(createError)
    }
  }

  const revoke = async (tokenId: string, label: string): Promise<void> => {
    try {
      await revokeMachineToken(tokenId)
      toast.notifySuccess(`${label} revoked`)
    } catch (revokeError) {
      toast.notifyError(revokeError)
    }
  }

  return (
    <Card size="2">
      <Flex direction="column" gap="4">
        <Flex justify="between" align="start" gap="4" wrap="wrap">
          <Flex direction="column" gap="1" maxWidth="620px">
            <Heading as="h2" size="3" weight="medium">
              Laptop runner
            </Heading>
            <Text size="2" color="gray">
              Runs the sessions you start from the board, the phone included, on your own Mac or Linux machine. It asks this
              dashboard for work every few seconds, so nothing here reaches into the laptop. Its token can only take and
              report starts.
            </Text>
          </Flex>
          <Dialog.Root open={isOpen} onOpenChange={closeDialog}>
            <Dialog.Trigger>
              <Button size="2">New runner</Button>
            </Dialog.Trigger>
            <Dialog.Content maxWidth="760px">
              <Dialog.Title>Set up a laptop runner</Dialog.Title>
              <Flex direction="column" gap="4">
                <SegmentedControl.Root
                  value={platform}
                  onValueChange={(value) => setPlatform(value === 'linux' ? 'linux' : 'macos')}
                  aria-label="Operating system"
                >
                  {(['macos', 'linux'] as const).map((listedPlatform) => (
                    <SegmentedControl.Item key={listedPlatform} value={listedPlatform}>
                      {platformLabels[listedPlatform]}
                    </SegmentedControl.Item>
                  ))}
                </SegmentedControl.Root>
                <RunnerSource scriptInfo={scriptInfo} platform={platform} />
                {runnerToken === null || scriptInfo === null ? (
                  <form onSubmit={(submitEvent) => void create(submitEvent)}>
                    <Dialog.Description size="2" color="gray" mb="3">
                      Name the machine. It needs Node 22.18 or later, git and Claude Code, logged in; tmux 3.2 or later for
                      sessions steered from the phone ({tmuxInstallOf[platform]}).
                    </Dialog.Description>
                    <TextField.Root
                      autoFocus
                      aria-label="Machine"
                      maxLength={80}
                      placeholder={platform === 'macos' ? 'Mac mini' : 'Workstation'}
                      value={runnerLabel}
                      onChange={(changeEvent) => setRunnerLabel(changeEvent.target.value)}
                    />
                    <Flex gap="3" mt="5" justify="end">
                      <Dialog.Close>
                        <Button type="button" variant="soft" color="gray">
                          Cancel
                        </Button>
                      </Dialog.Close>
                      <Button type="submit" disabled={runnerLabel.trim().length === 0 || runnerToken !== null}>
                        Create token
                      </Button>
                    </Flex>
                  </form>
                ) : (
                  <Flex direction="column" gap="3">
                    <Dialog.Description size="2" color="gray">
                      The token is in the commands below and shown only now; the dashboard keeps just its hash. Paste them into
                      a terminal on that machine.
                    </Dialog.Description>
                    <InstallCommands runnerToken={runnerToken} scriptInfo={scriptInfo} platform={platform} />
                    <Flex justify="end">
                      <Dialog.Close>
                        <Button>Done</Button>
                      </Dialog.Close>
                    </Flex>
                  </Flex>
                )}
              </Flex>
            </Dialog.Content>
          </Dialog.Root>
        </Flex>

        <CredentialGuideDetails guide={machineGuides['laptop-runner']} />

        {runnerTokens.length > 0 && (
          <Table.Root variant="ghost" size="2">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Machine</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Last asked for work</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Actions</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {runnerTokens.map((runnerToken) => (
                <Table.Row key={runnerToken.tokenId} align="center">
                  <Table.RowHeaderCell>
                    <Text size="2" weight="medium">
                      {runnerToken.label}
                    </Text>
                  </Table.RowHeaderCell>
                  <Table.Cell>
                    {runnerToken.lastUsedAt ? (
                      <Text size="2" color="gray">
                        {new Date(runnerToken.lastUsedAt).toLocaleString()}
                      </Text>
                    ) : (
                      <Badge variant="outline" color="gray" radius="full">
                        Never
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Button size="1" variant="ghost" color="red" onClick={() => void revoke(runnerToken.tokenId, runnerToken.label)}>
                      Revoke
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Flex>
    </Card>
  )
}
