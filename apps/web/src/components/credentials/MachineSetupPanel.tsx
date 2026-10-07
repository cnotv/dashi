import { Card, Flex, Heading, SegmentedControl, Text } from '@radix-ui/themes'
import { useState } from 'react'
import type { MachinePlatform } from '@dashi/contracts'
import { usePolledResource } from '@/hooks/usePolledResource'
import { machineGuides } from '@/lib/credential-guides'
import { dashboardApi } from '@/lib/api'
import { cliConnectCommands, platformLabels, platformOfUserAgent } from '@/lib/machine-setup'
import { dashboardAddress } from '@/lib/runtime-configuration'
import { CollapsibleSteps } from './CollapsibleSteps'
import { CopyableSnippet } from './CopyableSnippet'
import { CredentialGuideDetails } from './CredentialGuideDetails'
import { ServedScriptSource } from './ServedScriptSource'

// What dashi connect does, said plainly, so it can be checked against the source before it runs.
const cliDoesList = [
  'Checks for Node 22.18 or later, git and Claude Code, and that this dashboard answers.',
  'Shows a code and opens this dashboard to approve it. The tokens go straight to the CLI; nothing is pasted or shown.',
  'Lists the settings it adds to ~/.claude/settings.json and asks before writing them, keeping a copy of the old file.',
  'Installs the workflow plugin, whose hook reports each session here.',
  'If you tick it when approving, installs the laptop runner, checked by its own hash, as a login agent on macOS or a systemd user service on Linux.',
  'Runs every command as an argument list, never a shell string. dashi doctor checks it all again; dashi disconnect revokes the tokens and undoes it.',
]

/**
 * The Set up a machine panel: a button that unfolds the one command that downloads
 * the dashi CLI, checks its hash and connects the machine through a code approved on the pair page.
 */
export const MachineSetupPanel = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [platform, setPlatform] = useState<MachinePlatform>(() => platformOfUserAgent(navigator.userAgent))
  const { resource: scriptInfo } = usePolledResource(`cli-script-info-${isOpen}`, () => dashboardApi.readCliScriptInfo(), null)

  return (
    <Card size="2" id="set-up-a-machine">
      <Flex direction="column" gap="4">
        <Flex direction="column" gap="1" maxWidth="620px">
          <Heading as="h2" size="3" weight="medium">
            Set up a machine
          </Heading>
          <Text size="2" color="gray">
            One command connects a Mac or Linux machine. Its Claude Code sessions then report here, and, if you choose, it runs the
            sessions you start from the board. You approve it on this dashboard with a code. The panels below do the same by hand.
          </Text>
        </Flex>
        <CollapsibleSteps label="Set up a machine" isOpen={isOpen} onOpenChange={setIsOpen}>
          <SegmentedControl.Root
            value={platform}
            onValueChange={(value) => setPlatform(value === 'linux' ? 'linux' : 'macos')}
            aria-label="Operating system"
            className="platform-choice"
          >
            {(['macos', 'linux'] as const).map((listedPlatform) => (
              <SegmentedControl.Item key={listedPlatform} value={listedPlatform}>
                {platformLabels[listedPlatform]}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
          {scriptInfo && (
            <>
              <Text size="2" color="gray">
                Paste this into a terminal on the machine:
              </Text>
              <CopyableSnippet snippet={cliConnectCommands({ dashboardUrl: dashboardAddress(), scriptSha256: scriptInfo.sha256, platform })} />
            </>
          )}
          <ServedScriptSource scriptName="dashi" scriptInfo={scriptInfo} sourcePath="apps/cli/src/dashi.ts" doesList={cliDoesList} reviewSnippet={null} />
        </CollapsibleSteps>
        <CredentialGuideDetails guide={machineGuides['machine-setup']} />
      </Flex>
    </Card>
  )
}
