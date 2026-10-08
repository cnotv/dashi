import { ExternalLinkIcon, QuestionMarkCircledIcon } from '@radix-ui/react-icons'
import { Button, Code, Dialog, Flex, IconButton, Link, Text } from '@radix-ui/themes'
import type { CredentialGuide } from '@/lib/types'

// A call reads "GET https://api.github.com/user: Test"; the colon after the address starts its purpose.
const callParts = (call: string): { request: string; purpose: string } => {
  const separatorIndex = call.indexOf(': ')
  return separatorIndex === -1 ? { request: call, purpose: '' } : { request: call.slice(0, separatorIndex), purpose: call.slice(separatorIndex + 2) }
}

const GuideHeading = ({ text }: { text: string }) => (
  <Text as="div" size="1" weight="medium" color="gray">
    {text}
  </Text>
)

/**
 * A question mark beside a credential that opens what Dashi does with it: what it is used for,
 * each API call it makes, the permissions the token needs, and the documentation behind them.
 */
export const CredentialGuideDialog = ({ label, guide }: { label: string; guide: CredentialGuide }) => (
  <Dialog.Root>
    <Dialog.Trigger>
      <IconButton size="1" variant="ghost" color="gray" radius="full" aria-label={`How Dashi uses ${label}`}>
        <QuestionMarkCircledIcon />
      </IconButton>
    </Dialog.Trigger>
    <Dialog.Content maxWidth="640px">
      <Dialog.Title>How Dashi uses {label}</Dialog.Title>
      <Flex direction="column" gap="4">
        <Dialog.Description size="2">
          {guide.usedFor}
        </Dialog.Description>
        <Flex direction="column" gap="1">
          <GuideHeading text="API calls" />
          {guide.calls.map((call) => {
            const { request, purpose } = callParts(call)
            return (
              <Text key={call} as="div" size="1" className="credential-call">
                <Code variant="ghost" size="1">
                  {request}
                </Code>
                {purpose === '' ? null : ` ${purpose}`}
              </Text>
            )
          })}
        </Flex>
        <Flex direction="column" gap="1">
          <GuideHeading text="Permissions" />
          {guide.permissions.map((permission) => (
            <Text key={permission} as="div" size="1">
              {permission}
            </Text>
          ))}
        </Flex>
        <Flex direction="column" gap="1">
          <GuideHeading text="Documentation" />
          {guide.docs.map((link) => (
            <Link key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" size="1">
              <Flex gap="1" align="center" asChild>
                <span>
                  {link.label} <ExternalLinkIcon />
                </span>
              </Flex>
            </Link>
          ))}
        </Flex>
        <Flex justify="end">
          <Dialog.Close>
            <Button>Done</Button>
          </Dialog.Close>
        </Flex>
      </Flex>
    </Dialog.Content>
  </Dialog.Root>
)
