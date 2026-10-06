import { ExternalLinkIcon } from '@radix-ui/react-icons'
import { Badge, Flex, Text, Tooltip } from '@radix-ui/themes'
import { dataSources } from '@/lib/data-sources'
import type { DataSourceId } from '@/lib/types'

interface SourceTagsProps {
  sourceIds: DataSourceId[]
  // Says what a mixed or partial source leaves out, such as an agent it does not cover.
  note?: string
}

/**
 * The services a section's data comes from, each a tag linking to the documentation of the hook,
 * metric or API Dashi reads, with what it sends in its tooltip.
 */
export const SourceTags = ({ sourceIds, note }: SourceTagsProps) => (
  <Flex gap="1" align="center" wrap="wrap">
    <Text size="1" color="gray">
      From
    </Text>
    {sourceIds.map((sourceId) => {
      const source = dataSources[sourceId]
      return (
        <Tooltip key={sourceId} content={source.description}>
          <Badge asChild color="gray" variant="soft" radius="full">
            <a href={source.docsUrl} target="_blank" rel="noopener noreferrer">
              {source.label} <ExternalLinkIcon />
            </a>
          </Badge>
        </Tooltip>
      )
    })}
    {note && (
      <Text size="1" color="gray">
        {note}
      </Text>
    )}
  </Flex>
)
