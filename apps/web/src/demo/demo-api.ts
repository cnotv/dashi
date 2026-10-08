import type {
  BoardColumn,
  ChatMessage,
  IssueSummary,
  MachineTokenKind,
  MachineTokenSummary,
  NetlifyStatus,
  RepositoryReference,
  SecretEntrySummary,
  SecretSummary,
  SessionStart,
  SessionState,
  VaultState,
} from '@dashi/contracts'
import { sessionPromptFor } from '@dashi/contracts/first-message'
import { repositoryKey } from '@/lib/presentation'
import { chatKeyOf } from '@/lib/session-chat'
import type { DashboardApi, DemoPullRequestOutcome } from '@/lib/types'
import {
  sampleChatMessages,
  sampleIngestTokens,
  sampleRunnerTokens,
  sampleSessionStarts,
  sampleSessionsOverview,
  sampleUsageReport,
} from './sample-activity'
import { applyDemoPullRequestOutcomes, demoMediaUrls, sampleBoardColumns, samplePullRequestFiles } from './sample-board'
import { demoUser, sampleRepositories, sampleSecrets } from './sample-data'

// The same limits the server answers with, so the dialog behaves as it would against one.
const demoAttachmentLimits = { fileCount: 5, fileTargetBytes: 8 * 1024 * 1024, inlineTargetBytes: 40 * 1024 }
// Above every sample issue's number, so an issue opened in demo mode never takes one of theirs.
const firstDemoIssueNumber = 100

const withCreatedIssues = (columns: BoardColumn[], createdIssues: IssueSummary[]): BoardColumn[] =>
  columns.map((column) =>
    column.status === 'no-pull-request'
      ? { ...column, cards: [...createdIssues.map((issue) => ({ issues: [issue], pullRequest: null, status: column.status })), ...column.cards] }
      : column,
  )

const demoNetlifySite = (repository: RepositoryReference): NetlifyStatus => {
  const siteName = `${repository.owner}-${repository.name}`
  return { state: 'active', siteName, siteUrl: `https://${siteName}.netlify.app`, adminUrl: `https://app.netlify.com/projects/${siteName}` }
}

/**
 * Creates the in-page API that demo mode uses in place of a server.
 * Demo mode has no server: everything below lives in this page and is gone on reload, so a
 * value typed into the credentials dialog never leaves the browser.
 * @returns The demo API, holding its state in memory only.
 */
export const createDemoApi = (): DashboardApi => {
  const demoVaultState: VaultState = { mode: 'environment', initialised: true, unlocked: true }
  const demoSessionState: SessionState = { signInRequired: false, signInAvailable: false, user: demoUser }
  const demoMemory: {
    secrets: SecretSummary[]
    machineTokens: Record<MachineTokenKind, MachineTokenSummary[]>
    sessionStarts: SessionStart[]
    routineRepositoryKeys: Set<string>
    pullRequestOutcomes: Map<number, DemoPullRequestOutcome>
    netlifyRepositoryKeys: Set<string>
    chatMessages: Map<string, ChatMessage[]>
    createdIssues: Map<string, IssueSummary[]>
  } = {
    secrets: sampleSecrets.map((secret) => ({ ...secret })),
    machineTokens: { ingest: sampleIngestTokens.map((token) => ({ ...token })), runner: sampleRunnerTokens.map((token) => ({ ...token })) },
    sessionStarts: sampleSessionStarts(Date.now()),
    routineRepositoryKeys: new Set(['cnotv/example']),
    pullRequestOutcomes: new Map(),
    netlifyRepositoryKeys: new Set(['cnotv/example']),
    chatMessages: new Map(),
    createdIssues: new Map(),
  }
  const chatMessagesOf = (chatKey: string): ChatMessage[] => demoMemory.chatMessages.get(chatKey) ?? sampleChatMessages

  const entriesOf = (name: string): SecretEntrySummary[] => demoMemory.secrets.find((secret) => secret.name === name)?.entries ?? []
  // As on the server, the oldest token takes over when the one in use is removed.
  const replaceEntries = (name: string, entries: SecretEntrySummary[]): void => {
    const keptEntries = entries.length === 0 || entries.some((entry) => entry.isInUse) ? entries : entries.map((entry, index) => ({ ...entry, isInUse: index === 0 }))
    demoMemory.secrets = demoMemory.secrets.map((secret) => (secret.name === name ? { ...secret, entries: keptEntries } : secret))
  }

  return {
    signInUrl: '#',
    readSession: async () => demoSessionState,
    signOut: async () => undefined,
    readVault: async () => demoVaultState,
    setUpVault: async () => demoVaultState,
    unlockVault: async () => demoVaultState,
    lockVault: async () => demoVaultState,
    listSecrets: async () => demoMemory.secrets,
    addSecretEntry: async (name, { label, value, useNow }) => {
      const entries = entriesOf(name)
      const isFirst = entries.length === 0
      const entryId = isFirst ? 'default' : crypto.randomUUID().slice(0, 8)
      const entry = {
        entryId,
        label: label.trim() || (isFirst ? 'Default' : `Token ${entries.length + 1}`),
        lastFour: value.trim().slice(-4),
        isInUse: isFirst || useNow,
        updatedAt: new Date().toISOString(),
      }
      replaceEntries(name, [...entries.map((kept) => ({ ...kept, isInUse: kept.isInUse && !entry.isInUse })), entry])
      return { entryId }
    },
    updateSecretEntry: async (name, entryId, change) =>
      replaceEntries(
        name,
        entriesOf(name).map((entry) =>
          entry.entryId === entryId
            ? {
                ...entry,
                label: change.label?.trim() || entry.label,
                lastFour: change.value === undefined ? entry.lastFour : change.value.trim().slice(-4),
                updatedAt: new Date().toISOString(),
              }
            : entry,
        ),
      ),
    useSecretEntry: async (name, entryId) =>
      replaceEntries(name, entriesOf(name).map((entry) => ({ ...entry, isInUse: entry.entryId === entryId }))),
    deleteSecretEntry: async (name, entryId) => replaceEntries(name, entriesOf(name).filter((entry) => entry.entryId !== entryId)),
    testSecretEntry: async () => ({ ok: true, status: null, message: 'Demo mode: nothing was sent' }),
    listRepositories: async () => sampleRepositories,
    readBoard: async (repository) => ({
      repository,
      columns: withCreatedIssues(
        applyDemoPullRequestOutcomes(sampleBoardColumns, demoMemory.pullRequestOutcomes, new Date().toISOString()),
        demoMemory.createdIssues.get(repositoryKey(repository)) ?? [],
      ),
      fetchedAt: new Date().toISOString(),
    }),
    mergePullRequest: async (_repository, pullRequest) => {
      demoMemory.pullRequestOutcomes = new Map([...demoMemory.pullRequestOutcomes, [pullRequest.number, 'merged']])
    },
    closePullRequest: async (_repository, pullRequest) => {
      demoMemory.pullRequestOutcomes = new Map([...demoMemory.pullRequestOutcomes, [pullRequest.number, 'closed']])
    },
    setPullRequestDraft: async (_repository, pullRequest, isDraft) => {
      demoMemory.pullRequestOutcomes = new Map([...demoMemory.pullRequestOutcomes, [pullRequest.number, isDraft ? 'draft' : 'ready']])
    },
    readPullRequestFiles: async () => samplePullRequestFiles,
    readNetlifyStatus: async (repository) =>
      demoMemory.netlifyRepositoryKeys.has(repositoryKey(repository)) ? demoNetlifySite(repository) : { state: 'inactive' },
    enableNetlify: async (repository) => {
      demoMemory.netlifyRepositoryKeys = new Set([...demoMemory.netlifyRepositoryKeys, repositoryKey(repository)])
      return demoNetlifySite(repository)
    },
    readSessions: async (hours) => sampleSessionsOverview(hours, Date.now()),
    readSessionChat: async (target) => ({
      sessionId: chatKeyOf(target),
      availability: 'on-laptop',
      deliveryRoute: 'tmux',
      sendBlocker: null,
      messages: chatMessagesOf(chatKeyOf(target)),
      deliveries: [],
      updatedAt: new Date().toISOString(),
    }),
    sendChatMessage: async (target, text) => {
      const createdAt = new Date().toISOString()
      const typedMessage: ChatMessage = { messageId: `demo-typed-${createdAt}`, role: 'user', kind: 'text', text, toolName: null, createdAt }
      const reply: ChatMessage = {
        messageId: `demo-reply-${createdAt}`,
        role: 'assistant',
        kind: 'text',
        text: 'Demo mode: this reply is canned, and your message went to no session.',
        toolName: null,
        createdAt,
      }
      const chatKey = chatKeyOf(target)
      demoMemory.chatMessages = new Map([...demoMemory.chatMessages, [chatKey, [...chatMessagesOf(chatKey), typedMessage, reply]]])
      return { deliveryId: `demo-${createdAt}`, text, state: 'delivered', message: null, createdAt }
    },
    readUsage: async (days) => sampleUsageReport(days, Date.now()),
    listMachineTokens: async (kind) => demoMemory.machineTokens[kind],
    createMachineToken: async (kind, label) => {
      const summary = { tokenId: `demo-${kind}-${demoMemory.machineTokens[kind].length + 1}`, label, createdAt: new Date().toISOString(), lastUsedAt: null }
      demoMemory.machineTokens = { ...demoMemory.machineTokens, [kind]: [...demoMemory.machineTokens[kind], summary] }
      return { summary, token: `${kind === 'ingest' ? 'adt' : 'adr'}_demo-only-this-token-does-not-work-anywhere` }
    },
    revokeMachineToken: async (kind, tokenId) => {
      demoMemory.machineTokens = { ...demoMemory.machineTokens, [kind]: demoMemory.machineTokens[kind].filter((token) => token.tokenId !== tokenId) }
    },
    readStartOptions: async (repository) => ({
      runners: [{ label: 'Mac mini', lastSeenAt: new Date().toISOString(), isOnline: true }],
      routineConfigured: demoMemory.routineRepositoryKeys.has(repositoryKey(repository)),
      attachmentLimits: demoAttachmentLimits,
    }),
    createIssue: async (repository, newIssue) => {
      const createdIssues = demoMemory.createdIssues.get(repositoryKey(repository)) ?? []
      const issueNumber = firstDemoIssueNumber + [...demoMemory.createdIssues.values()].flat().length
      const url = `https://github.com/${repository.owner}/${repository.name}/issues/${issueNumber}`
      const issue: IssueSummary = {
        number: issueNumber,
        title: newIssue.title,
        url,
        updatedAt: new Date().toISOString(),
        closedAt: null,
        labels: [],
        linkedPullRequestNumbers: [],
      }
      demoMemory.createdIssues = new Map([...demoMemory.createdIssues, [repositoryKey(repository), [issue, ...createdIssues]]])
      return { number: issueNumber, url }
    },
    listSessionStarts: async () => demoMemory.sessionStarts,
    startSession: async ({ attachments, ...request }) => {
      const now = new Date().toISOString()
      const start: SessionStart = {
        ...request,
        startId: `demo-start-${demoMemory.sessionStarts.length + 1}`,
        state: 'started',
        runnerLabel: request.target === 'cloud-routine' ? null : 'Mac mini',
        sessionUrl: null,
        message: attachments.length === 0 ? 'Demo mode: nothing was started' : 'Demo mode: nothing was started, and its attachments stayed in this page',
        createdAt: now,
        updatedAt: now,
      }
      demoMemory.sessionStarts = [start, ...demoMemory.sessionStarts]
      return start
    },
    readSessionStart: async (startId) => {
      const start = demoMemory.sessionStarts.find((listedStart) => listedStart.startId === startId)
      if (start === undefined) throw new Error('Unknown start')
      return { start, firstMessage: sessionPromptFor(start, []) }
    },
    retrySessionStart: async (startId) => {
      const failedStart = demoMemory.sessionStarts.find((listedStart) => listedStart.startId === startId)
      if (failedStart === undefined) throw new Error('Unknown start')
      const now = new Date().toISOString()
      const retried: SessionStart = {
        ...failedStart,
        startId: `demo-start-${demoMemory.sessionStarts.length + 1}`,
        state: 'started',
        sessionUrl: null,
        message: 'Demo mode: nothing was started',
        createdAt: now,
        updatedAt: now,
      }
      demoMemory.sessionStarts = [retried, ...demoMemory.sessionStarts]
      return retried
    },
    testRoutine: async (repository) =>
      demoMemory.routineRepositoryKeys.has(repositoryKey(repository))
        ? { ok: true, sessionUrl: 'https://claude.ai/code' }
        : { ok: false, message: 'Save a routine id and token first' },
    readRunnerScriptInfo: async () => ({ sha256: '0'.repeat(64), byteLength: 0, sourcePath: 'apps/runner/src/runner.ts' }),
    readCliScriptInfo: async () => ({ sha256: '0'.repeat(64), byteLength: 0, sourcePath: 'apps/cli/src/dashi.ts' }),
    describePairing: async (userCode) => ({
      userCode: userCode.toUpperCase(),
      hostname: 'Studio-MacBook-Pro.local',
      platform: 'macos',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }),
    approvePairing: async (approval) => {
      const created = [
        { kind: 'ingest' as const, summary: { tokenId: `demo-ingest-${approval.userCode}`, label: approval.label, createdAt: new Date().toISOString(), lastUsedAt: null } },
        ...(approval.withRunner
          ? [{ kind: 'runner' as const, summary: { tokenId: `demo-runner-${approval.userCode}`, label: approval.label, createdAt: new Date().toISOString(), lastUsedAt: null } }]
          : []),
      ]
      demoMemory.machineTokens = created.reduce(
        (tokens, { kind, summary }) => ({ ...tokens, [kind]: [...tokens[kind], summary] }),
        demoMemory.machineTokens,
      )
    },
    readRoutineSettings: async (repository) => {
      const configured = demoMemory.routineRepositoryKeys.has(repositoryKey(repository))
      return { configured, routineId: configured ? 'trig_01DemoRoutine' : null }
    },
    saveRoutineSettings: async (repository) => {
      demoMemory.routineRepositoryKeys = new Set([...demoMemory.routineRepositoryKeys, repositoryKey(repository)])
    },
    deleteRoutineSettings: async (repository) => {
      demoMemory.routineRepositoryKeys = new Set([...demoMemory.routineRepositoryKeys].filter((key) => key !== repositoryKey(repository)))
    },
    pullRequestMediaUrl: (_repository, _pullRequest, kind) => demoMediaUrls[kind],
  }
}
