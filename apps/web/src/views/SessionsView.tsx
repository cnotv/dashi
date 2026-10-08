import { Callout, Flex, Grid, SegmentedControl } from '@radix-ui/themes'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import type { AgentSessionState, SessionStart } from '@dashi/contracts'
import { NewIssueDialog } from '@/components/board/NewIssueDialog'
import { SourceTags } from '@/components/charts/SourceTags'
import { StatTile } from '@/components/charts/StatTile'
import { SessionChatDrawer } from '@/components/sessions/SessionChatDrawer'
import { SessionStartsList } from '@/components/sessions/SessionStartsList'
import { StartDetailsDrawer } from '@/components/sessions/StartDetailsDrawer'
import { SessionsTable } from '@/components/sessions/SessionsTable'
import { useSessionsOverview } from '@/hooks/useActivity'
import { useSessionStarts } from '@/hooks/useSessionStarts'
import { formatCompactCount } from '@/lib/presentation'
import { chatSubjectOfSession, chatSubjectOfStart } from '@/lib/session-chat'
import type { ChatSubject } from '@/lib/types'

const windowChoices = [
  { value: '6', label: '6 hours' },
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
]

const windowHoursFrom = (value: string | null): number => Number(windowChoices.find((choice) => choice.value === value)?.value ?? 24)

/** The Sessions page: the starts from the board, counts by state, the timeline of running sessions, the sessions table and a session's chat. */
export const SessionsView = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const windowHours = windowHoursFrom(searchParams.get('hours'))
  const { resource: overview, errorMessage, isStale } = useSessionsOverview(windowHours)
  const [startsRevision, setStartsRevision] = useState(0)
  const { resource: sessionStarts } = useSessionStarts(startsRevision)
  const [chatSubject, setChatSubject] = useState<ChatSubject | null>(null)
  const [detailedStart, setDetailedStart] = useState<SessionStart | null>(null)

  const countInState = (state: AgentSessionState): number => overview?.sessions.filter((session) => session.state === state).length ?? 0
  const windowTokens = overview?.sessions.reduce((sum, session) => sum + session.tokens.total, 0) ?? 0

  return (
    <Flex direction="column" gap="5">
      <Flex gap="3" align="center" wrap="wrap">
        <SegmentedControl.Root
          value={String(windowHours)}
          onValueChange={(nextHours) => setSearchParams({ hours: nextHours }, { replace: true })}
          aria-label="Time window"
        >
          {windowChoices.map((choice) => (
            <SegmentedControl.Item key={choice.value} value={choice.value}>
              {choice.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
        <Flex ml="auto">
          <NewIssueDialog defaultRepository={null} />
        </Flex>
      </Flex>

      {errorMessage && (
        <Callout.Root color="red" variant="surface">
          <Callout.Text>{errorMessage}</Callout.Text>
        </Callout.Root>
      )}

      {sessionStarts && sessionStarts.length > 0 && overview && (
        <SessionStartsList
          starts={sessionStarts}
          windowHours={windowHours}
          windowStartedAt={overview.windowStartedAt}
          onOpenChat={(start) => setChatSubject(chatSubjectOfStart(start))}
          onOpenDetails={setDetailedStart}
          onDeleted={() => setStartsRevision((revision) => revision + 1)}
        />
      )}
      <StartDetailsDrawer
        start={detailedStart}
        onClose={() => setDetailedStart(null)}
        onRetried={() => {
          setDetailedStart(null)
          setStartsRevision((revision) => revision + 1)
        }}
      />

      {overview && (
        <>
          <Grid columns={{ initial: '2', md: '4' }} gap="4">
            <StatTile label="Working" value={String(countInState('working'))} />
            <StatTile label="Waiting for you" value={String(countInState('waiting'))} />
            <StatTile label="Idle" value={String(countInState('idle'))} />
            <StatTile
              label="Tokens in this window"
              value={formatCompactCount(windowTokens)}
              detail={<SourceTags sourceIds={['claude-code-otel']} note="Claude Code only" />}
            />
          </Grid>
          <SessionsTable
            overview={overview}
            isStale={isStale}
            onOpenChat={(session) => setChatSubject(chatSubjectOfSession(session))}
          />
        </>
      )}
      <SessionChatDrawer subject={chatSubject} onClose={() => setChatSubject(null)} />
    </Flex>
  )
}
