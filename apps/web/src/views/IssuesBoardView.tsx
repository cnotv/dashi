import { ChevronDownIcon, ChevronRightIcon, ReloadIcon } from '@radix-ui/react-icons'
import { Badge, Button, Callout, Flex, IconButton, SegmentedControl, Select, Skeleton, Text } from '@radix-ui/themes'
import { useMemo, useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router'
import { BoardCardItem } from '@/components/board/BoardCardItem'
import { NetlifyControl } from '@/components/board/NetlifyControl'
import { NewIssueDialog } from '@/components/board/NewIssueDialog'
import { WorkflowSkillsPrompt } from '@/components/board/WorkflowSkillsPrompt'
import { useBoards, useRepositories } from '@/hooks/useBoard'
import { useCollapsedColumns } from '@/hooks/useCollapsedColumns'
import { useSessionStarts } from '@/hooks/useSessionStarts'
import { mergeBoards } from '@/lib/board-merge'
import { issueStatusColors, issueStatusLabels, parseRepositoryKey, repositoryKey } from '@/lib/presentation'

const skeletonColumnCount = 6
const allRepositoriesKey = 'all'

/**
 * The Issues page: issues and pull requests as a board, one column per status, for every
 * configured repository at once unless the address names one with `?repository=owner/name`. The
 * sessions started from Dashi are read alongside, so the issues they work on get their own column.
 * Above it, the question to add agent-base's workflow skills to a shown repository that lacks them.
 */
export const IssuesBoardView = () => {
  const { repositories, errorMessage: repositoriesError } = useRepositories()
  const [searchParams, setSearchParams] = useSearchParams()

  const firstRepositoryKey = repositories[0] ? repositoryKey(repositories[0]) : ''
  const repositoryParameter = searchParams.get('repository')
  const showsAllRepositories = repositoryParameter === null
  const selectedRepositoryKey = repositoryParameter ?? firstRepositoryKey
  const selectedRepository = useMemo(() => parseRepositoryKey(selectedRepositoryKey), [selectedRepositoryKey])
  const shownRepositories = useMemo(
    () => (showsAllRepositories ? repositories : selectedRepository ? [selectedRepository] : []),
    [showsAllRepositories, repositories, selectedRepository],
  )
  const { boards, isLoading, errorMessage, refresh } = useBoards(shownRepositories)
  const [startsRevision, setStartsRevision] = useState(0)
  const { resource: sessionStarts } = useSessionStarts(startsRevision)
  const columns = useMemo(() => mergeBoards(boards, sessionStarts ?? []), [boards, sessionStarts])
  const oldestFetchedAt = boards.map((board) => board.fetchedAt).sort()[0]

  const selectRepository = (nextKey: string): void => setSearchParams({ repository: nextKey }, { replace: true })
  const selectScope = (scope: string): void =>
    scope === allRepositoriesKey ? setSearchParams({}, { replace: true }) : selectRepository(firstRepositoryKey)

  const loadError = repositoriesError ?? errorMessage
  const { collapsedStatuses, toggleColumn } = useCollapsedColumns()

  return (
    <Flex direction="column" gap="5">
      <Flex gap="3" align="center" wrap="wrap">
        <SegmentedControl.Root
          value={showsAllRepositories ? allRepositoriesKey : 'one'}
          onValueChange={selectScope}
          aria-label="Repositories shown"
        >
          <SegmentedControl.Item value={allRepositoriesKey}>All repositories</SegmentedControl.Item>
          <SegmentedControl.Item value="one">One repository</SegmentedControl.Item>
        </SegmentedControl.Root>
        {!showsAllRepositories && (
          <Select.Root value={selectedRepositoryKey} onValueChange={selectRepository}>
            <Select.Trigger placeholder="Choose a repository" aria-label="Repository" style={{ minWidth: 240 }} />
            <Select.Content>
              {repositories.map((repository) => (
                <Select.Item key={repositoryKey(repository)} value={repositoryKey(repository)}>
                  {repositoryKey(repository)}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        )}
        <Button variant="soft" color="gray" onClick={refresh} loading={isLoading}>
          <ReloadIcon /> Refresh
        </Button>
        {oldestFetchedAt && (
          <Text size="1" color="gray">
            Updated {new Date(oldestFetchedAt).toLocaleTimeString()}
          </Text>
        )}
        <Flex ml="auto" gap="3" align="center">
          {!showsAllRepositories && selectedRepository && <NetlifyControl repository={selectedRepository} />}
          <NewIssueDialog defaultRepository={showsAllRepositories ? null : selectedRepository} />
        </Flex>
      </Flex>

      <WorkflowSkillsPrompt repositories={shownRepositories} />

      {loadError && (
        <Callout.Root color="red" variant="surface">
          <Callout.Text>
            {loadError} <RouterLink to="/credentials">Open Credentials</RouterLink>
          </Callout.Text>
        </Callout.Root>
      )}

      {isLoading && boards.length === 0 && (
        <div className="board-columns">
          {Array.from({ length: skeletonColumnCount }, (_, placeholderIndex) => (
            <Skeleton key={placeholderIndex} className="board-column" height="160px" />
          ))}
        </div>
      )}

      {columns.length > 0 && (
        <div className="board-columns">
          {columns.map((column) => {
            const isCollapsed = collapsedStatuses.includes(column.status)
            const columnLabel = issueStatusLabels[column.status]
            return (
              <section
                key={column.status}
                className={isCollapsed ? 'board-column board-column-collapsed' : 'board-column'}
                aria-label={columnLabel}
              >
                <div className="board-column-header">
                  <IconButton
                    size="1"
                    variant="ghost"
                    color="gray"
                    aria-expanded={!isCollapsed}
                    aria-label={isCollapsed ? `Show ${columnLabel}` : `Fold ${columnLabel}`}
                    onClick={() => toggleColumn(column.status)}
                  >
                    {isCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                  </IconButton>
                  <Text size="2" weight="medium" className="board-column-title">
                    {columnLabel}
                  </Text>
                  <Badge color={issueStatusColors[column.status]} variant="soft" radius="full">
                    {column.cards.length}
                  </Badge>
                </div>
                {!isCollapsed &&
                  column.cards.map(({ card, repository, sessionStart }) => (
                    <BoardCardItem
                      key={`${repositoryKey(repository)}-${card.pullRequest ? `pull-${card.pullRequest.number}` : `issue-${card.issues[0]?.number}`}`}
                      card={card}
                      repository={repository}
                      showRepository={showsAllRepositories}
                      sessionStart={sessionStart}
                      onPullRequestChanged={refresh}
                      onStartChanged={() => setStartsRevision((revision) => revision + 1)}
                    />
                  ))}
              </section>
            )
          })}
        </div>
      )}
    </Flex>
  )
}
