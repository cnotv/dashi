import { FileTextIcon, GlobeIcon, Link2Icon } from '@radix-ui/react-icons'
import { Badge, Card, Flex, IconButton, Link, Separator, Text, Tooltip } from '@radix-ui/themes'
import type { BoardCard, IssueSummary, RepositoryReference } from '@dashi/contracts'
import { isReadyTicket, openBlockers } from '@/lib/issue-relations'
import { GateIndicator } from './GateIndicator'
import { PullRequestActions } from './PullRequestActions'
import { PullRequestFilesDrawer } from './PullRequestFilesDrawer'
import { PullRequestMedia } from './PullRequestMedia'
import { StartSessionDialog } from './StartSessionDialog'

interface BoardCardItemProps {
  card: BoardCard
  repository: RepositoryReference
  showRepository: boolean
  onPullRequestChanged: () => void
}

const EpicLine = ({ issue }: { issue: IssueSummary }) =>
  issue.parent === null ? null : (
    <Text size="1" color="gray">
      Epic{' '}
      <Link href={issue.parent.url} target="_blank" rel="noopener noreferrer" color="gray" underline="hover">
        #{issue.parent.number} {issue.parent.title}
      </Link>
    </Text>
  )

const SubIssueProgress = ({ issue }: { issue: IssueSummary }) =>
  issue.subIssues.length === 0 ? null : (
    <Text size="1" color="gray">
      {issue.subIssues.filter((subIssue) => subIssue.state === 'closed').length} of {issue.subIssues.length} sub-issues closed
    </Text>
  )

const RelationBadges = ({ issue }: { issue: IssueSummary }) => {
  const blockers = openBlockers(issue)
  return (
    <Flex gap="1" wrap="wrap">
      {blockers.map((blocker) => (
        <Badge key={blocker.number} color="orange" variant="soft" radius="full" asChild>
          <a href={blocker.url} target="_blank" rel="noopener noreferrer" title={blocker.title}>
            blocked by #{blocker.number}
          </a>
        </Badge>
      ))}
      {isReadyTicket(issue) && (
        <Badge color="green" variant="soft" radius="full">
          ready
        </Badge>
      )}
    </Flex>
  )
}

const IssueHeading = ({ issue }: { issue: IssueSummary }) => (
  <Flex direction="column" gap="1">
    <EpicLine issue={issue} />
    <Link href={issue.url} target="_blank" rel="noopener noreferrer" size="2" weight="medium" highContrast underline="hover">
      #{issue.number} {issue.title}
    </Link>
    <SubIssueProgress issue={issue} />
    <RelationBadges issue={issue} />
    {issue.labels.length > 0 && (
      <Flex gap="1" wrap="wrap">
        {issue.labels.map((label) => (
          <Badge key={label.name} variant="outline" color="gray" radius="full">
            {label.name}
          </Badge>
        ))}
      </Flex>
    )}
  </Flex>
)

const closedDateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

const ClosedNote = ({ issue }: { issue: IssueSummary }) => (
  <Text size="1" color="gray">
    Closed {issue.closedAt ? closedDateFormat.format(new Date(issue.closedAt)) : ''}
  </Text>
)

const PreviewButton = ({ previewUrl }: { previewUrl: string | null }) =>
  previewUrl === null ? (
    <Tooltip content="No deploy preview yet">
      <span>
        <IconButton size="1" variant="ghost" color="gray" disabled aria-label="No deploy preview yet">
          <GlobeIcon />
        </IconButton>
      </span>
    </Tooltip>
  ) : (
    <Tooltip content="Open the deploy preview">
      <IconButton size="1" variant="ghost" aria-label="Open the deploy preview" asChild>
        <a href={previewUrl} target="_blank" rel="noopener noreferrer">
          <GlobeIcon />
        </a>
      </IconButton>
    </Tooltip>
  )

/**
 * One board card: its repository when the board shows several, every issue its pull request works
 * on with the pull request's checks at the top right, then the pull request, and one row of icons.
 * An issue without a pull request has only Start; a pull request has its merge conflict, deploy
 * preview, screenshot, video, changed files, merge and close. A closed issue says when it closed
 * and keeps the preview, recording and files of the merged pull request that closed it.
 */
export const BoardCardItem = ({ card, repository, showRepository, onPullRequestChanged }: BoardCardItemProps) => (
  <Card size="2">
    <Flex direction="column" gap="3">
      <Flex gap="3" align="start" justify="between">
        <Flex direction="column" gap="2" minWidth="0">
          {showRepository && (
            <Link
              size="1"
              color="gray"
              href={`https://github.com/${repository.owner}/${repository.name}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {repository.owner}/{repository.name}
            </Link>
          )}
          {card.issues.length === 0 ? (
            <Text size="2" color="gray">
              No linked issue
            </Text>
          ) : (
            card.issues.map((issue) => <IssueHeading key={issue.number} issue={issue} />)
          )}
          {card.status === 'closed' && card.issues[0] && <ClosedNote issue={card.issues[0]} />}
        </Flex>
        {card.pullRequest && <GateIndicator gates={card.pullRequest.gates} summary={card.pullRequest.gateSummary} />}
      </Flex>
      {card.pullRequest && (
        <>
          <Separator size="4" />
          <Flex gap="2" align="start">
            {card.pullRequest.isDraft ? <FileTextIcon /> : <Link2Icon />}
            <Link href={card.pullRequest.url} target="_blank" rel="noopener noreferrer" size="1" color="gray" underline="hover">
              #{card.pullRequest.number} {card.pullRequest.title}
            </Link>
          </Flex>
        </>
      )}
      {card.status === 'closed' && card.pullRequest && (
        <>
          <Separator size="4" />
          <Flex className="card-icon-row" gap="2" align="center">
            <PreviewButton previewUrl={card.pullRequest.previewUrl} />
            <PullRequestMedia repository={repository} pullRequest={card.pullRequest} />
            <PullRequestFilesDrawer repository={repository} pullRequest={card.pullRequest} />
          </Flex>
        </>
      )}
      {card.status !== 'closed' && (
        <>
          <Separator size="4" />
          <Flex className="card-icon-row" gap="2" align="center">
            {card.pullRequest === null ? (
              <StartSessionDialog repository={repository} issue={card.issues[0] ?? null} />
            ) : (
              <>
                {card.pullRequest.mergeable === 'CONFLICTING' && (
                  <StartSessionDialog repository={repository} issue={card.issues[0] ?? null} conflictingPullRequest={card.pullRequest} />
                )}
                <PreviewButton previewUrl={card.pullRequest.previewUrl} />
                <PullRequestMedia repository={repository} pullRequest={card.pullRequest} />
                <PullRequestFilesDrawer repository={repository} pullRequest={card.pullRequest} />
                <PullRequestActions repository={repository} pullRequest={card.pullRequest} onChanged={onPullRequestChanged} />
              </>
            )}
          </Flex>
        </>
      )}
    </Flex>
  </Card>
)
