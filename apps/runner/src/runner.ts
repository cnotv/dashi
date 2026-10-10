// Dashi's laptop runner. It asks the dashboard every few seconds for a session
// started from the board, prepares a fresh worktree of the repository, and starts Claude Code
// there. While a chat drawer is open in Dashi it also sends that session's recent transcript and
// delivers the messages typed there, to a cloud session too, with claude --cloud. It needs Node 22.18 or later, git, Claude Code and, for
// sessions steered from the phone, tmux 3.2 or later. Every command is an argument list; nothing
// goes through a shell.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type StartTarget = 'laptop-remote-control' | 'laptop-headless' | 'laptop-cloud'
type PermissionMode = 'auto' | 'acceptEdits' | 'dontAsk'

interface RepositoryReference {
  owner: string
  name: string
}

interface StartAttachment {
  name: string
  mediaType: string
  base64: string
}

interface ClaimedStart {
  start: { startId: string; repository: RepositoryReference; target: StartTarget; permissionMode: PermissionMode; openRouterModel: string | null }
  prompt: string
  sessionName: string
  attachments: StartAttachment[]
}

interface RunnerSettings {
  dashboardUrl: string
  runnerToken: string
  runnerHome: string
  claudeHome: string
  pollMilliseconds: number
}

type SessionState = 'working' | 'waiting' | 'idle' | 'ended' | 'inactive'

type LaptopTarget = 'laptop-remote-control' | 'laptop-headless'

interface ChatWorkStart {
  repositoryName: string
  startId: string
  target: LaptopTarget
}

interface ChatWorkSession {
  sessionId: string
  sessionState: SessionState | null
  start: ChatWorkStart | null
  cloudSessionId: string | null
  openRouterModel: string | null
}

interface ChatWorkDelivery extends ChatWorkSession {
  deliveryId: string
  text: string
}

interface ChatWork {
  sessions: ChatWorkSession[]
  deliveries: ChatWorkDelivery[]
}

interface ChatMessage {
  messageId: string
  role: 'user' | 'assistant'
  kind: 'text' | 'tool'
  text: string
  toolName: string | null
  createdAt: string | null
}

interface TranscriptSummary {
  directory: string | null
  messages: ChatMessage[]
}

interface TmuxPane {
  paneId: string
  directory: string
  command: string
}

type DeliveryPlan = { route: 'tmux'; paneId: string } | { route: 'resume'; directory: string } | { route: 'none'; reason: string }

interface LocatedTranscript {
  path: string
  claudeSessionId: string
  modifiedAt: number
}

interface TranscriptFile {
  name: string
  modifiedAt: number
}

interface SentTranscript {
  modifiedAt: number
  sentAt: number
}

interface RunnerPaths {
  clonePath: string
  worktreePath: string
  logPath: string
  attachmentsPath: string
}

interface LaunchPlan {
  mode: 'tmux' | 'detached' | 'capture'
  command: string
  args: string[]
  cwd: string
  // Added to the session's environment; the status hook reports DASHI_START_ID, so Dashi knows the session came from the board.
  environment: Record<string, string>
}

interface LaunchOutcome {
  sessionUrl: string | null
  message: string
}

const laptopTargets: StartTarget[] = ['laptop-remote-control', 'laptop-headless', 'laptop-cloud']
const permissionModes: PermissionMode[] = ['auto', 'acceptEdits', 'dontAsk']
// The same pattern as openRouterModelPattern in packages/contracts, repeated because the runner is
// served as one file. It keeps a model to a slug, so it can never pass for a flag or another variable.
const openRouterModelPattern = /^~?[a-z0-9][a-z0-9._-]{0,63}\/[A-Za-z0-9._:-]{1,100}$/
const openRouterBaseUrl = 'https://openrouter.ai/api'
const defaultPollMilliseconds = 5000
const cloudCommandTimeoutMilliseconds = 180_000
const cloudSessionUrlPattern = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+/
const chatPollMilliseconds = 1500
// An unattended session writes to its transcript as it works, so one quiet for a minute has
// finished and can be resumed with the next message.
const unattendedQuietMilliseconds = 60_000
const chatTargets: LaptopTarget[] = ['laptop-remote-control', 'laptop-headless']
const transcriptResendMilliseconds = 15_000
const transcriptMessageLimit = 150
const chatTextLimit = 4000
const toolSummaryLimit = 300
const sessionStates: SessionState[] = ['working', 'waiting', 'idle', 'ended', 'inactive']
const sessionIdPattern = /^[A-Za-z0-9_-]{8,100}$/
const cloudSessionIdPattern = /^session_[A-Za-z0-9]{1,100}$/
const cloudSendTimeoutMilliseconds = 60_000
const deliveryIdPattern = /^[0-9a-f-]{36}$/
// A pane showing a shell would run pasted text as a command, so only a pane whose foreground
// process is Claude Code gets it. Claude Code names its process claude, or its version on some
// installs; a bare node pane is only a fallback, since a dev server in the same folder runs as node too.
const claudePaneCommandPattern = /^(claude|\d+\.\d+\.\d+)$/
const fallbackPaneCommand = 'node'

/**
 * Checks a repository the dashboard sent before it becomes a path or a clone address.
 * @param repository The repository from the claimed start.
 * @returns True when owner and name are plain GitHub names.
 */
export const isSafeRepository = (repository: RepositoryReference): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(repository.owner) &&
  /^[A-Za-z0-9._-]{1,100}$/.test(repository.name) &&
  repository.name !== '.' &&
  repository.name !== '..'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isOneOf = <Allowed extends string>(allowedValues: Allowed[], value: unknown): value is Allowed =>
  allowedValues.some((allowedValue) => allowedValue === value)

// The same rule the dashboard applies: a plain base name, so writing it cannot leave the folder.
const isSafeAttachment = (attachment: unknown): attachment is StartAttachment =>
  isRecord(attachment) &&
  typeof attachment.name === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/.test(attachment.name) &&
  !attachment.name.includes('..') &&
  typeof attachment.mediaType === 'string' &&
  typeof attachment.base64 === 'string' &&
  /^[A-Za-z0-9+/]*={0,2}$/.test(attachment.base64)

const parseAttachments = (attachmentsBody: unknown): StartAttachment[] | null => {
  if (attachmentsBody === undefined) return []
  if (!Array.isArray(attachmentsBody)) return null
  const attachments = attachmentsBody.filter(isSafeAttachment)
  return attachments.length === attachmentsBody.length ? attachments : null
}

// A dashboard from before OpenRouter sends no model, which runs on the Claude login like null.
const openRouterModelOf = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) return null
  return typeof value === 'string' && openRouterModelPattern.test(value) ? value : undefined
}

/**
 * Reads a claim from the dashboard, checking everything in it that reaches a command line.
 * @param claimBody The parsed JSON the dashboard answered with.
 * @returns The claim, or null when any part is not one the runner knows.
 */
export const parseClaim = (claimBody: unknown): ClaimedStart | null => {
  if (!isRecord(claimBody) || !isRecord(claimBody.start)) return null
  const { start, prompt, sessionName } = claimBody
  const { startId, target, permissionMode, repository: repositoryBody } = start
  const attachments = parseAttachments(claimBody.attachments)
  const openRouterModel = openRouterModelOf(start.openRouterModel)
  if (!isRecord(repositoryBody) || attachments === null || openRouterModel === undefined) return null
  const repository = { owner: String(repositoryBody.owner), name: String(repositoryBody.name) }
  if (typeof prompt !== 'string' || typeof sessionName !== 'string' || typeof startId !== 'string') return null
  if (!/^[0-9a-f-]{36}$/.test(startId) || !isSafeRepository(repository)) return null
  if (!isOneOf(laptopTargets, target) || !isOneOf(permissionModes, permissionMode)) return null
  if (openRouterModel !== null && target !== 'laptop-headless') return null
  return { start: { startId, repository, target, permissionMode, openRouterModel }, prompt, sessionName, attachments }
}

/**
 * Works out where a start's clone, worktree and log live under the runner's home.
 * @param runnerHome The runner's folder, ~/dashi unless set.
 * @param claimed The claimed start.
 * @returns The three paths.
 */
export const runnerPathsFor = (runnerHome: string, claimed: ClaimedStart): RunnerPaths => {
  const { owner, name } = claimed.start.repository
  const folderName = startFolderNameFor(name, claimed.start.startId)
  return {
    clonePath: join(runnerHome, 'repos', owner, name),
    worktreePath: join(runnerHome, 'worktrees', folderName),
    logPath: join(runnerHome, 'logs', `${folderName}.log`),
    attachmentsPath: join(runnerHome, 'attachments', folderName),
  }
}

/**
 * Adds the paths of a start's attachments to its prompt, once they are written beside the
 * worktree rather than inside it, so nothing of them is committed.
 * @param claimed The claimed start.
 * @param paths Where the start's files live.
 * @returns The claim with the attachments named in its prompt.
 */
export const withAttachmentPaths = (claimed: ClaimedStart, paths: RunnerPaths): ClaimedStart =>
  claimed.attachments.length === 0
    ? claimed
    : {
        ...claimed,
        prompt: [
          claimed.prompt,
          'Attachments, saved on this laptop; read each with the Read tool:',
          claimed.attachments.map((attachment) => `- ${join(paths.attachmentsPath, attachment.name)}`).join('\n'),
        ].join('\n\n'),
      }

/**
 * Names a start's worktree and log after its repository and the start's short id.
 * @param repositoryName The repository's name.
 * @param startId The start's id.
 * @returns The folder name, such as generative-art-0123abcd.
 */
export const startFolderNameFor = (repositoryName: string, startId: string): string => `${repositoryName}-${startId.slice(0, 8)}`

/**
 * Tells whether a folder under ~/.claude/projects holds the transcripts of a start's worktree.
 * Claude Code names that folder after the working directory with every character that is not a
 * letter or digit turned into a dash.
 * @param projectFolder The folder's name.
 * @param start The start.
 * @returns True when it is the start's worktree.
 */
export const isStartProjectFolder = (projectFolder: string, start: ChatWorkStart): boolean =>
  projectFolder.endsWith(`/worktrees/${startFolderNameFor(start.repositoryName, start.startId)}`.replace(/[^A-Za-z0-9]/g, '-'))

/**
 * Picks the session a start's worktree is running: the transcript written to last.
 * @param files The files in the worktree's project folder.
 * @returns The newest transcript, or null when there is none.
 */
export const newestTranscriptOf = (files: TranscriptFile[]): TranscriptFile | null =>
  files
    .filter((file) => file.name.endsWith('.jsonl'))
    .reduce<TranscriptFile | null>((newest, file) => (newest === null || file.modifiedAt > newest.modifiedAt ? file : newest), null)

/**
 * Names the tmux session a steerable start runs in; tmux refuses dots and colons.
 * @param claimed The claimed start.
 * @returns The tmux session name.
 */
export const tmuxSessionNameFor = (claimed: ClaimedStart): string =>
  `agent-${claimed.start.repository.name.replace(/[^A-Za-z0-9-]/g, '-')}-${claimed.start.startId.slice(0, 8)}`

/**
 * The environment that points Claude Code at an OpenRouter model, with the laptop's own key.
 * Every model role is set to the one chosen, so no background call goes to a model it did not pick.
 * @param openRouterModel The model slug, or null for the Claude login.
 * @param runnerEnvironment The runner's environment, which holds OPENROUTER_API_KEY.
 * @returns The variables to add; none for the Claude login.
 */
export const modelEnvironmentFor = (openRouterModel: string | null, runnerEnvironment: NodeJS.ProcessEnv): Record<string, string> => {
  if (openRouterModel === null) return {}
  const openRouterKey = runnerEnvironment.OPENROUTER_API_KEY ?? ''
  if (openRouterKey === '') {
    throw new Error("This start runs on OpenRouter: set OPENROUTER_API_KEY in the runner's environment, then retry it")
  }
  return {
    ANTHROPIC_BASE_URL: openRouterBaseUrl,
    ANTHROPIC_AUTH_TOKEN: openRouterKey,
    // Empty rather than unset, or Claude Code would sign in to Anthropic with a key of its own.
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: openRouterModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: openRouterModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: openRouterModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: openRouterModel,
  }
}

/**
 * The environment a session runs with: the runner's, without the laptop's OpenRouter key, plus
 * what the start adds. The key reaches only a session on OpenRouter, and only as its auth token,
 * so no other session, or a script a repository runs inside one, can read it.
 * @param runnerEnvironment The runner's environment.
 * @param additions The variables the start adds.
 * @returns The session's environment.
 */
export const sessionEnvironmentFor = (runnerEnvironment: NodeJS.ProcessEnv, additions: Record<string, string>): NodeJS.ProcessEnv => {
  const withoutOpenRouterKey = Object.fromEntries(Object.entries(runnerEnvironment).filter(([name]) => name !== 'OPENROUTER_API_KEY'))
  return { ...withoutOpenRouterKey, ...additions }
}

/**
 * Decides the command that starts a claimed session, by where it should run.
 * @param claimed The claimed start.
 * @param paths Where its clone, worktree and log live.
 * @param runnerEnvironment The runner's environment, read for the OpenRouter key of an OpenRouter start.
 * @returns The command, its arguments and folder, and how to run it.
 */
export const launchPlanFor = (claimed: ClaimedStart, paths: RunnerPaths, runnerEnvironment: NodeJS.ProcessEnv): LaunchPlan => {
  const environment = { DASHI_START_ID: claimed.start.startId }
  if (claimed.start.target === 'laptop-cloud') {
    return { mode: 'capture', command: 'claude', args: ['--cloud', claimed.prompt], cwd: paths.clonePath, environment }
  }
  if (claimed.start.target === 'laptop-headless') {
    return {
      mode: 'detached',
      command: 'claude',
      args: ['-p', claimed.prompt, '--permission-mode', claimed.start.permissionMode, '--output-format', 'json'],
      cwd: paths.worktreePath,
      environment: { ...environment, ...modelEnvironmentFor(claimed.start.openRouterModel, runnerEnvironment) },
    }
  }
  // Remote Control needs a terminal, so the session gets one from tmux; with more than one
  // argument tmux runs the command directly, not through a shell. A tmux server already running
  // keeps its own environment, so the start id goes in with -e.
  return {
    mode: 'tmux',
    command: 'tmux',
    args: [
      'new-session',
      '-d',
      '-s',
      tmuxSessionNameFor(claimed),
      '-c',
      paths.worktreePath,
      '-e',
      `DASHI_START_ID=${claimed.start.startId}`,
      'claude',
      '--remote-control',
      '--name',
      claimed.sessionName,
      claimed.prompt,
    ],
    cwd: paths.worktreePath,
    environment,
  }
}

/**
 * Finds the claude.ai link a cloud session prints when it starts.
 * @param commandOutput What claude --cloud wrote.
 * @returns The link, or null when there is none.
 */
export const cloudSessionUrlFrom = (commandOutput: string): string | null => cloudSessionUrlPattern.exec(commandOutput)?.[0] ?? null

const chatWorkStartOf = (value: unknown): ChatWorkStart | null | undefined => {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) return undefined
  const { repositoryName, startId, target } = value
  if (typeof repositoryName !== 'string' || typeof startId !== 'string' || !isOneOf(chatTargets, target)) return undefined
  if (!isSafeRepository({ owner: 'x', name: repositoryName }) || !/^[0-9a-f-]{36}$/.test(startId)) return undefined
  return { repositoryName, startId, target }
}

const chatWorkCloudSessionOf = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) return null
  return typeof value === 'string' && cloudSessionIdPattern.test(value) ? value : undefined
}

const chatWorkSessionOf = (value: unknown): ChatWorkSession | null => {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || !sessionIdPattern.test(value.sessionId)) return null
  const sessionState = value.sessionState === null ? null : isOneOf(sessionStates, value.sessionState) ? value.sessionState : undefined
  const start = chatWorkStartOf(value.start)
  const cloudSessionId = chatWorkCloudSessionOf(value.cloudSessionId)
  const openRouterModel = openRouterModelOf(value.openRouterModel)
  if (sessionState === undefined || start === undefined || cloudSessionId === undefined || openRouterModel === undefined) return null
  return { sessionId: value.sessionId, sessionState, start, cloudSessionId, openRouterModel }
}

const chatWorkDeliveryOf = (value: unknown): ChatWorkDelivery | null => {
  const workSession = chatWorkSessionOf(value)
  if (workSession === null || !isRecord(value)) return null
  const { deliveryId, text } = value
  if (typeof deliveryId !== 'string' || !deliveryIdPattern.test(deliveryId) || typeof text !== 'string' || text.length > 8000) return null
  return { ...workSession, deliveryId, text }
}

/**
 * Reads the chat work the dashboard hands out, keeping only entries whose ids are safe to use as
 * file names and command arguments.
 * @param workBody The parsed JSON the dashboard answered with.
 * @returns The sessions to read and the messages to deliver.
 */
export const parseChatWork = (workBody: unknown): ChatWork => {
  if (!isRecord(workBody)) return { sessions: [], deliveries: [] }
  const listOf = <Item>(value: unknown, itemOf: (entry: unknown) => Item | null): Item[] =>
    Array.isArray(value)
      ? value.flatMap((entry): Item[] => {
          const item = itemOf(entry)
          return item === null ? [] : [item]
        })
      : []
  return { sessions: listOf(workBody.sessions, chatWorkSessionOf), deliveries: listOf(workBody.deliveries, chatWorkDeliveryOf) }
}

const clipped = (text: string, characterLimit: number): string => (text.length > characterLimit ? `${text.slice(0, characterLimit)}…` : text)

const summaryOfToolInput = (input: unknown): string => {
  if (!isRecord(input)) return ''
  const summary = [input.command, input.file_path, input.pattern, input.url, input.description, input.prompt].find(
    (candidate) => typeof candidate === 'string' && candidate.length > 0,
  )
  return typeof summary === 'string' ? clipped(summary.replace(/\s+/g, ' '), toolSummaryLimit) : ''
}

// A slash command reaches the transcript as tagged text; it is shown as it was typed, and the
// output of local commands is left out.
const userTextOf = (text: string): string | null => {
  if (text.startsWith('<local-command') || text.startsWith('Caveat:')) return null
  const commandName = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1]
  if (commandName === undefined) return text
  const commandArguments = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1] ?? ''
  return `${commandName} ${commandArguments}`.trim()
}

const messagesOfEntry = (entry: Record<string, unknown>): ChatMessage[] => {
  const { type, uuid, timestamp, message } = entry
  if ((type !== 'user' && type !== 'assistant') || typeof uuid !== 'string' || !isRecord(message)) return []
  if (entry.isSidechain === true || entry.isMeta === true) return []
  const createdAt = typeof timestamp === 'string' ? timestamp : null
  const textMessage = (text: string, index: number): ChatMessage => ({
    messageId: `${uuid}-${index}`,
    role: type,
    kind: 'text',
    text: clipped(text, chatTextLimit),
    toolName: null,
    createdAt,
  })
  const { content } = message
  if (typeof content === 'string') {
    const text = type === 'user' ? userTextOf(content) : content
    return text === null || text.trim() === '' ? [] : [textMessage(text, 0)]
  }
  if (!Array.isArray(content)) return []
  return content.flatMap((block: unknown, index): ChatMessage[] => {
    if (!isRecord(block)) return []
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      const text = type === 'user' ? userTextOf(block.text) : block.text
      return text === null ? [] : [textMessage(text, index)]
    }
    if (block.type === 'tool_use' && type === 'assistant' && typeof block.name === 'string') {
      return [{ messageId: `${uuid}-${index}`, role: 'assistant', kind: 'tool', text: summaryOfToolInput(block.input), toolName: block.name, createdAt }]
    }
    return []
  })
}

const parsedLineOf = (line: string): Record<string, unknown> | null => {
  try {
    const parsedLine: unknown = JSON.parse(line)
    return isRecord(parsedLine) ? parsedLine : null
  } catch {
    return null
  }
}

/**
 * Turns a Claude Code transcript into the chat the drawer shows: what was typed, what Claude
 * answered and which tools it used, without tool results, thinking or side conversations.
 * @param transcriptText The session's .jsonl transcript.
 * @returns The folder the session runs in and its most recent messages.
 */
export const summariseTranscript = (transcriptText: string): TranscriptSummary => {
  const entries = transcriptText.split('\n').flatMap((line): Record<string, unknown>[] => {
    const parsedLine = parsedLineOf(line)
    return parsedLine === null ? [] : [parsedLine]
  })
  const directory = entries.map((entry) => entry.cwd).find((cwd): cwd is string => typeof cwd === 'string') ?? null
  return { directory, messages: entries.flatMap(messagesOfEntry).slice(-transcriptMessageLimit) }
}

/**
 * Reads the output of tmux list-panes in the runner's format: pane id, command, then the folder.
 * tmux prints a tab in a format as an underscore, so the fields are split on spaces and the
 * folder, which may hold spaces itself, comes last.
 * @param listOutput What tmux printed.
 * @returns One entry per pane.
 */
export const parseTmuxPanes = (listOutput: string): TmuxPane[] =>
  listOutput.split('\n').flatMap((line) => {
    const [paneId, command, ...directoryParts] = line.split(' ')
    const directory = directoryParts.join(' ')
    return paneId && command && directory && /^%\d+$/.test(paneId) ? [{ paneId, directory, command }] : []
  })

/**
 * Decides how a message reaches a session: typed into the tmux pane running it, or given to a
 * resumed copy of a session that has ended. A session asking for a permission is left alone, since
 * the message would land on the permission prompt.
 * @param sessionState The state Dashi knows for the session, or null when its hooks never reported.
 * @param panes The tmux panes on this machine.
 * @param directory The folder the session runs in, from its transcript.
 * @returns The route, or why there is none.
 */
export const deliveryPlanFor = (sessionState: SessionState | null, panes: TmuxPane[], directory: string | null): DeliveryPlan => {
  if (directory === null) return { route: 'none', reason: 'The transcript does not say which folder the session runs in' }
  if (sessionState === 'waiting') return { route: 'none', reason: 'It is waiting on a permission or a question; answer it in the Claude app or the terminal' }
  if (sessionState === 'ended' || sessionState === 'inactive') return { route: 'resume', directory }
  const panesInFolder = panes.filter((candidate) => candidate.directory === directory)
  const pane =
    panesInFolder.find((candidate) => claudePaneCommandPattern.test(candidate.command)) ??
    panesInFolder.find((candidate) => candidate.command === fallbackPaneCommand)
  if (pane !== undefined) return { route: 'tmux', paneId: pane.paneId }
  return { route: 'none', reason: 'It runs in a terminal the runner cannot type into; sessions started from Dashi, or run in tmux, can be chatted with' }
}

/**
 * Decides how a message reaches a chat's session. A session started unattended from the board has
 * no hooks state to go by, so it counts as running while its transcript keeps changing and as
 * ended, ready to be resumed, once it has been quiet for a minute.
 * @param workSession The chat's session, with its start when it was started from the board.
 * @param panes The tmux panes on this machine.
 * @param directory The folder the session runs in, from its transcript.
 * @param quietMilliseconds How long ago its transcript last changed.
 * @returns The route, or why there is none.
 */
export const chatDeliveryPlanFor = (
  workSession: ChatWorkSession,
  panes: TmuxPane[],
  directory: string | null,
  quietMilliseconds: number,
): DeliveryPlan => {
  if (workSession.start?.target !== 'laptop-headless') return deliveryPlanFor(workSession.sessionState, panes, directory)
  if (quietMilliseconds < unattendedQuietMilliseconds) {
    return { route: 'none', reason: 'It is still running unattended; send a message once it finishes' }
  }
  return deliveryPlanFor('ended', panes, directory)
}

/**
 * The command line that queues one message into a running cloud session. The message itself goes
 * on standard input, so no text can be read as an option.
 * @param cloudSessionId The cloud session, as session_<id>.
 * @returns The arguments for claude.
 */
export const cloudSendArgumentsFor = (cloudSessionId: string): string[] => ['-p', '--cloud', cloudSessionId, '--output-format', 'json']

/**
 * Reads how claude --cloud answered a message sent to a cloud session.
 * @param standardOutput What it printed on stdout: {ok, session_id, url} on success, {ok: false, error} on a failed send.
 * @param standardError What it printed on stderr, where a configuration error goes as plain text.
 * @returns Delivered, or failed with the reason.
 */
export const cloudSendOutcomeOf = (standardOutput: string, standardError: string): { state: 'delivered' | 'failed'; message: string | null } => {
  const answer = standardOutput
    .split('\n')
    .map((line): unknown => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .find((parsedLine) => isRecord(parsedLine) && typeof parsedLine.ok === 'boolean')
  if (isRecord(answer) && answer.ok === true) return { state: 'delivered', message: null }
  const reason = isRecord(answer) && typeof answer.error === 'string' ? answer.error : lastCharacters(`${standardError}\n${standardOutput}`, 300)
  return { state: 'failed', message: reason === '' ? 'claude --cloud gave no answer' : reason }
}

/**
 * The command line that continues an ended session with one message, unattended.
 * @param sessionId The session to resume.
 * @param text The message.
 * @returns The arguments for claude.
 */
export const resumeArgumentsFor = (sessionId: string, text: string): string[] => [
  '--resume',
  sessionId,
  '-p',
  text,
  '--permission-mode',
  'auto',
  '--output-format',
  'json',
]

// A runner installed before the rename to Dashi has its settings under AGENT_DASHBOARD_* names,
// which still count while the DASHI_* name is unset.
const readSetting = (environment: NodeJS.ProcessEnv, name: string): string | undefined =>
  environment[`DASHI_${name}`] || environment[`AGENT_DASHBOARD_${name}`] || undefined

/**
 * Reads the runner's settings from its environment.
 * @param environment The process environment.
 * @returns The settings, or the reason they are incomplete.
 */
export const readRunnerSettings = (environment: NodeJS.ProcessEnv): RunnerSettings | string => {
  const dashboardUrl = (readSetting(environment, 'URL') ?? '').replace(/\/+$/, '')
  const runnerToken = readSetting(environment, 'RUNNER_TOKEN') ?? ''
  if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(dashboardUrl)) {
    return 'Set DASHI_URL to the dashboard address, https:// unless it runs on this machine'
  }
  if (!runnerToken.startsWith('adr_')) return 'Set DASHI_RUNNER_TOKEN to a runner token from the dashboard'
  return {
    dashboardUrl,
    runnerToken,
    runnerHome: readSetting(environment, 'RUNNER_HOME') ?? join(homedir(), 'dashi'),
    claudeHome: environment.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
    pollMilliseconds: Number(readSetting(environment, 'RUNNER_POLL_MS') ?? defaultPollMilliseconds),
  }
}

const lastCharacters = (text: string, characterCount: number): string => text.trim().slice(-characterCount)

const runOrThrow = (command: string, args: string[], cwd?: string): void => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ''} failed: ${lastCharacters(result.stderr, 500)}`)
}

const prepareClone = ({ repository }: ClaimedStart['start'], clonePath: string): void => {
  if (!existsSync(clonePath)) {
    mkdirSync(dirname(clonePath), { recursive: true })
    runOrThrow('git', ['clone', `https://github.com/${repository.owner}/${repository.name}.git`, clonePath])
  }
  runOrThrow('git', ['-C', clonePath, 'fetch', '--prune', 'origin'])
}

const prepareWorktree = ({ clonePath, worktreePath }: RunnerPaths): void => {
  mkdirSync(dirname(worktreePath), { recursive: true })
  runOrThrow('git', ['-C', clonePath, 'worktree', 'add', '--detach', worktreePath, 'origin/HEAD'])
}

const launch = (plan: LaunchPlan, claimed: ClaimedStart, paths: RunnerPaths): LaunchOutcome => {
  if (plan.mode === 'capture') {
    const result = spawnSync(plan.command, plan.args, {
      cwd: plan.cwd,
      env: sessionEnvironmentFor(process.env, plan.environment),
      encoding: 'utf8',
      timeout: cloudCommandTimeoutMilliseconds,
    })
    const commandOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    const sessionUrl = cloudSessionUrlFrom(commandOutput)
    if (sessionUrl === null) throw new Error(`claude --cloud printed no session link: ${lastCharacters(commandOutput, 500)}`)
    return { sessionUrl, message: 'Running in Claude cloud' }
  }
  if (plan.mode === 'detached') {
    mkdirSync(dirname(paths.logPath), { recursive: true })
    const logDescriptor = openSync(paths.logPath, 'a')
    spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: sessionEnvironmentFor(process.env, plan.environment),
      detached: true,
      stdio: ['ignore', logDescriptor, logDescriptor],
    }).unref()
    return { sessionUrl: null, message: `Running unattended in ${plan.cwd}; its output goes to ${paths.logPath}` }
  }
  // A tmux server this starts keeps this environment for every session it later runs.
  const result = spawnSync(plan.command, plan.args, { encoding: 'utf8', env: sessionEnvironmentFor(process.env, {}) })
  if (result.error) throw new Error('tmux is needed for sessions steered from the phone: brew install tmux')
  if (result.status !== 0) throw new Error(`tmux failed: ${lastCharacters(result.stderr, 500)}`)
  return {
    sessionUrl: null,
    message: `Open "${claimed.sessionName}" in the Claude app; on the laptop, tmux attach -t ${tmuxSessionNameFor(claimed)}`,
  }
}

const reportOutcome = async (settings: RunnerSettings, startId: string, report: unknown): Promise<void> => {
  await fetch(`${settings.dashboardUrl}/api/runner/starts/${startId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.runnerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
    signal: AbortSignal.timeout(15000),
  })
}

const writeAttachments = (claimed: ClaimedStart, paths: RunnerPaths): void => {
  if (claimed.attachments.length === 0) return
  mkdirSync(paths.attachmentsPath, { recursive: true })
  claimed.attachments.forEach((attachment) =>
    writeFileSync(join(paths.attachmentsPath, attachment.name), Buffer.from(attachment.base64, 'base64'), { mode: 0o600 }),
  )
}

const startClaimedSession = async (settings: RunnerSettings, claimed: ClaimedStart): Promise<void> => {
  const paths = runnerPathsFor(settings.runnerHome, claimed)
  try {
    prepareClone(claimed.start, paths.clonePath)
    if (claimed.start.target !== 'laptop-cloud') prepareWorktree(paths)
    writeAttachments(claimed, paths)
    const outcome = launch(launchPlanFor(withAttachmentPaths(claimed, paths), paths, process.env), claimed, paths)
    process.stdout.write(`Started ${claimed.sessionName}: ${outcome.message}\n`)
    await reportOutcome(settings, claimed.start.startId, { state: 'started', ...outcome })
  } catch (startError) {
    const message = startError instanceof Error ? startError.message : String(startError)
    process.stdout.write(`Could not start ${claimed.sessionName}: ${message}\n`)
    await reportOutcome(settings, claimed.start.startId, { state: 'failed', sessionUrl: null, message })
  }
}

const postToDashboard = (settings: RunnerSettings, path: string, body: unknown): Promise<Response> =>
  fetch(`${settings.dashboardUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.runnerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })

const realDirectoryOf = (directory: string): string => {
  try {
    return realpathSync(directory)
  } catch {
    return directory
  }
}

const findTranscriptPath = (claudeHome: string, sessionId: string): string | null => {
  const projectsPath = join(claudeHome, 'projects')
  try {
    return (
      readdirSync(projectsPath)
        .map((projectFolder) => join(projectsPath, projectFolder, `${sessionId}.jsonl`))
        .find((candidatePath) => existsSync(candidatePath)) ?? null
    )
  } catch {
    return null
  }
}

const listTmuxPanes = (): TmuxPane[] => {
  const result = spawnSync('tmux', ['list-panes', '-a', '-F', '#{pane_id} #{pane_current_command} #{pane_current_path}'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) return []
  return parseTmuxPanes(result.stdout).map((pane) => ({ ...pane, directory: realDirectoryOf(pane.directory) }))
}

const findStartTranscriptPath = (claudeHome: string, start: ChatWorkStart): string | null => {
  const projectsPath = join(claudeHome, 'projects')
  try {
    const projectFolder = readdirSync(projectsPath).find((folderName) => isStartProjectFolder(folderName, start))
    if (projectFolder === undefined) return null
    const folderPath = join(projectsPath, projectFolder)
    const newest = newestTranscriptOf(
      readdirSync(folderPath).map((name) => ({ name, modifiedAt: statSync(join(folderPath, name)).mtimeMs })),
    )
    return newest === null ? null : join(folderPath, newest.name)
  } catch {
    return null
  }
}

// A chat opened from the board names its start rather than a Claude session, whose id is only
// known once the session has written its transcript in the start's worktree.
const locateTranscript = (settings: RunnerSettings, workSession: ChatWorkSession): LocatedTranscript | null => {
  const transcriptPath =
    workSession.start === null
      ? findTranscriptPath(settings.claudeHome, workSession.sessionId)
      : findStartTranscriptPath(settings.claudeHome, workSession.start)
  if (transcriptPath === null) return null
  return { path: transcriptPath, claudeSessionId: basename(transcriptPath, '.jsonl'), modifiedAt: statSync(transcriptPath).mtimeMs }
}

const readSessionTranscript = (located: LocatedTranscript): TranscriptSummary => {
  const summary = summariseTranscript(readFileSync(located.path, 'utf8'))
  return { ...summary, directory: summary.directory === null ? null : realDirectoryOf(summary.directory) }
}

// A transcript is sent again only when it changed, or now and then so a reopened drawer fills.
const sendTranscript = async (settings: RunnerSettings, workSession: ChatWorkSession, sentTranscripts: Map<string, SentTranscript>): Promise<void> => {
  const located = locateTranscript(settings, workSession)
  const modifiedAt = located?.modifiedAt ?? 0
  const lastSent = sentTranscripts.get(workSession.sessionId)
  if (lastSent && lastSent.modifiedAt === modifiedAt && Date.now() - lastSent.sentAt < transcriptResendMilliseconds) return
  const summary = located === null ? null : readSessionTranscript(located)
  const plan = chatDeliveryPlanFor(workSession, summary === null ? [] : listTmuxPanes(), summary?.directory ?? null, Date.now() - modifiedAt)
  const report = {
    found: summary !== null,
    messages: summary?.messages ?? [],
    deliveryRoute: plan.route,
    sendBlocker: plan.route === 'none' ? plan.reason : null,
  }
  const reportResponse = await postToDashboard(settings, `/api/runner/chat/${workSession.sessionId}`, report)
  if (reportResponse.ok) sentTranscripts.set(workSession.sessionId, { modifiedAt, sentAt: Date.now() })
}

const runTmux = (args: string[], input?: string): void => {
  const result = spawnSync('tmux', args, { encoding: 'utf8', input })
  if (result.error || result.status !== 0) throw new Error(`tmux ${args[0] ?? ''} failed: ${lastCharacters(result.stderr ?? '', 300)}`)
}

// Pasted as a bracketed paste, so a message of several lines arrives whole instead of being sent
// line by line, then submitted with Enter.
const typeIntoPane = (paneId: string, text: string): void => {
  const bufferName = `dashi-${process.pid}`
  runTmux(['load-buffer', '-b', bufferName, '-'], text)
  runTmux(['paste-buffer', '-p', '-d', '-b', bufferName, '-t', paneId])
  runTmux(['send-keys', '-t', paneId, 'Enter'])
}

const resumeWithMessage = (settings: RunnerSettings, claudeSessionId: string, delivery: ChatWorkDelivery, directory: string): string => {
  const environment = sessionEnvironmentFor(process.env, modelEnvironmentFor(delivery.openRouterModel, process.env))
  const logPath = join(settings.runnerHome, 'logs', `chat-${claudeSessionId.slice(0, 8)}.log`)
  mkdirSync(dirname(logPath), { recursive: true })
  const logDescriptor = openSync(logPath, 'a')
  spawn('claude', resumeArgumentsFor(claudeSessionId, delivery.text), {
    cwd: directory,
    env: environment,
    detached: true,
    stdio: ['ignore', logDescriptor, logDescriptor],
  }).unref()
  return `Resumed unattended; its output goes to ${logPath}`
}

// Needs this machine's claude logged in to the claude.ai account the cloud session belongs to.
const sendToCloudSession = (cloudSessionId: string, text: string): { state: 'delivered' | 'failed'; message: string | null } => {
  const result = spawnSync('claude', cloudSendArgumentsFor(cloudSessionId), {
    input: text,
    encoding: 'utf8',
    timeout: cloudSendTimeoutMilliseconds,
    env: sessionEnvironmentFor(process.env, {}),
  })
  if (result.error) return { state: 'failed', message: result.error.message }
  return cloudSendOutcomeOf(result.stdout ?? '', result.stderr ?? '')
}

const deliverMessage = async (settings: RunnerSettings, delivery: ChatWorkDelivery): Promise<void> => {
  if (delivery.cloudSessionId !== null) {
    await postToDashboard(settings, `/api/runner/deliveries/${delivery.deliveryId}`, sendToCloudSession(delivery.cloudSessionId, delivery.text))
    return
  }
  const located = locateTranscript(settings, delivery)
  const plan: DeliveryPlan =
    located === null
      ? { route: 'none', reason: 'The session is not on this laptop' }
      : chatDeliveryPlanFor(delivery, listTmuxPanes(), readSessionTranscript(located).directory, Date.now() - located.modifiedAt)
  const outcome = ((): { state: 'delivered' | 'failed'; message: string | null } => {
    try {
      if (plan.route === 'tmux') {
        typeIntoPane(plan.paneId, delivery.text)
        return { state: 'delivered', message: null }
      }
      if (plan.route === 'resume' && located !== null) {
        return { state: 'delivered', message: resumeWithMessage(settings, located.claudeSessionId, delivery, plan.directory) }
      }
      if (plan.route === 'resume') return { state: 'failed', message: 'The session is not on this laptop' }
      return { state: 'failed', message: plan.reason }
    } catch (deliveryError) {
      return { state: 'failed', message: deliveryError instanceof Error ? deliveryError.message : String(deliveryError) }
    }
  })()
  await postToDashboard(settings, `/api/runner/deliveries/${delivery.deliveryId}`, outcome)
}

// Returns whether any drawer is open, so the loop asks again sooner while someone is chatting.
const relayChatsOnce = async (settings: RunnerSettings, sentTranscripts: Map<string, SentTranscript>): Promise<boolean> => {
  const workResponse = await postToDashboard(settings, '/api/runner/chat-work', {})
  if (!workResponse.ok) return false
  const work = parseChatWork(await workResponse.json())
  await work.deliveries.reduce(
    (previous, delivery) =>
      previous.then(async () => {
        await deliverMessage(settings, delivery)
        sentTranscripts.delete(delivery.sessionId)
      }),
    Promise.resolve(),
  )
  await Promise.all(work.sessions.map((workSession) => sendTranscript(settings, workSession, sentTranscripts)))
  return work.sessions.length > 0
}

const pollOnce = async (settings: RunnerSettings): Promise<void> => {
  const claimResponse = await fetch(`${settings.dashboardUrl}/api/runner/claim`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.runnerToken}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(15000),
  })
  if (claimResponse.status === 204) return
  if (!claimResponse.ok) throw new Error(`The dashboard answered ${claimResponse.status}`)
  const claimed = parseClaim(await claimResponse.json())
  if (claimed === null) {
    process.stderr.write('The runner refused a start it could not read\n')
    return
  }
  await startClaimedSession(settings, claimed)
}

const writePollError = (pollError: unknown): false => {
  process.stderr.write(`${pollError instanceof Error ? pollError.message : String(pollError)}\n`)
  return false
}

const pollForever = (settings: RunnerSettings, sentTranscripts: Map<string, SentTranscript>): void => {
  pollOnce(settings)
    .catch(writePollError)
    .then(() => relayChatsOnce(settings, sentTranscripts).catch(writePollError))
    .then((isChatOpen) =>
      setTimeout(() => pollForever(settings, sentTranscripts), isChatOpen ? chatPollMilliseconds : settings.pollMilliseconds),
    )
}

const isRunDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isRunDirectly) {
  const settings = readRunnerSettings(process.env)
  if (typeof settings === 'string') {
    process.stderr.write(`${settings}\n`)
    process.exit(1)
  }
  process.stdout.write(`Waiting for sessions from ${settings.dashboardUrl}; working in ${settings.runnerHome}\n`)
  pollForever(settings, new Map())
}
