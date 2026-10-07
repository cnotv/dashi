import { ExternalLinkIcon } from '@radix-ui/react-icons'
import { Code, Flex, Link, Text } from '@radix-ui/themes'
import { useState } from 'react'
import { CollapsibleSteps } from '@/components/credentials/CollapsibleSteps'
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
 * What Dashi does with a credential, folded under it: what it is used for, each API call it makes,
 * the permissions the token needs, and the documentation behind them.
 */
export const CredentialGuideDetails = ({ guide }: { guide: CredentialGuide }) => {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <CollapsibleSteps label="How Dashi uses it" isOpen={isOpen} onOpenChange={setIsOpen}>
      <Text as="p" size="2">
        {guide.usedFor}
      </Text>
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
    </CollapsibleSteps>
  )
}
