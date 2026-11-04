import { ArrowLeftIcon } from '@radix-ui/react-icons'
import { Callout, Card, Flex, Heading, Link, Skeleton, Text } from '@radix-ui/themes'
import { useMemo } from 'react'
import { Link as RouterLink, useParams } from 'react-router'
import { EpicTicketsTable } from '@/components/board/EpicTicketsTable'
import { useBoards } from '@/hooks/useBoard'
import { buildEpicViewRows } from '@/lib/epic-tickets'

/**
 * One epic: every ticket in dependency order with its state, blockers, agent and pull request.
 * Its address is /epics/<owner>/<repository>/<epic number>, so it can be shared and reloaded.
 */
export const EpicView = () => {
  const { owner, name, number } = useParams()
  const epicNumber = Number(number)
  const repositories = useMemo(() => (owner && name ? [{ owner, name }] : []), [owner, name])
  const { boards, isLoading, errorMessage } = useBoards(repositories)
  const epicCard = boards
    .flatMap((board) => board.columns.flatMap((column) => column.cards))
    .find((card) => card.issues.some((issue) => issue.number === epicNumber))
  const epic = epicCard?.issues.find((issue) => issue.number === epicNumber)
  const rows = useMemo(() => (epic && epicCard ? buildEpicViewRows(epic, epicCard.tickets) : []), [epic, epicCard])
  const closedCount = rows.filter((row) => row.state === 'closed').length

  return (
    <Flex direction="column" gap="4">
      <Text size="2">
        <Link asChild>
          <RouterLink to={owner && name ? `/issues?repository=${owner}/${name}` : '/issues'}>
            <ArrowLeftIcon /> Back to the board
          </RouterLink>
        </Link>
      </Text>
      {errorMessage && (
        <Callout.Root color="red" variant="surface">
          <Callout.Text>{errorMessage}</Callout.Text>
        </Callout.Root>
      )}
      {isLoading && boards.length === 0 && <Skeleton height="160px" />}
      {!isLoading && boards.length > 0 && epic === undefined && (
        <Callout.Root color="gray" variant="surface">
          <Callout.Text>
            Epic #{epicNumber} is not open in {owner}/{name}.
          </Callout.Text>
        </Callout.Root>
      )}
      {epic && (
        <Card size="2">
          <Flex direction="column" gap="3">
            <Flex direction="column" gap="1">
              <Heading size="4">
                <Link href={epic.url} target="_blank" rel="noopener noreferrer" highContrast underline="hover">
                  #{epic.number} {epic.title}
                </Link>
              </Heading>
              <Text size="1" color="gray">
                {closedCount} of {epic.subIssues.length} sub-issues closed
              </Text>
            </Flex>
            {rows.length === 0 ? <Text color="gray">This epic has no tickets yet.</Text> : <EpicTicketsTable rows={rows} />}
          </Flex>
        </Card>
      )}
    </Flex>
  )
}
