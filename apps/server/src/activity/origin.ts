import type { SessionBilling, StoredSession, StoredTokenSample, UsageStart } from './types.ts'

const sessionBillings: SessionBilling[] = ['api-key', 'bedrock', 'vertex', 'foundry', 'claude-login', 'chatgpt-login']

/**
 * Reads a billing kind the hook reported, or stored, keeping only the kinds it can send.
 * @param value The reported or stored value.
 * @returns The billing kind, or null.
 */
export const sessionBillingOf = (value: unknown): SessionBilling | null => sessionBillings.find((billing) => billing === value) ?? null

export const notReportedLabel = 'Not reported'
export const notReportedNote = 'Recorded before Dashi asked, or the workflow plugin is older than 0.5.0'
const noClaudeAccountLabel = 'No Claude account'

// Keyed by a process name, a macOS bundle id or a TERM_PROGRAM value.
const terminalNames: Record<string, string> = {
  iTerm2: 'iTerm',
  'iTerm.app': 'iTerm',
  'com.googlecode.iterm2': 'iTerm',
  Terminal: 'Terminal',
  Apple_Terminal: 'Terminal',
  'com.apple.Terminal': 'Terminal',
  Warp: 'Warp',
  stable: 'Warp',
  WarpTerminal: 'Warp',
  'dev.warp.Warp-Stable': 'Warp',
  ghostty: 'Ghostty',
  'com.mitchellh.ghostty': 'Ghostty',
  kitty: 'kitty',
  alacritty: 'Alacritty',
  'wezterm-gui': 'WezTerm',
  WezTerm: 'WezTerm',
  'gnome-terminal-server': 'GNOME Terminal',
  konsole: 'Konsole',
  tmux: 'tmux',
  sshd: 'SSH',
}

const editorNames: Record<string, string> = {
  'claude-vscode': 'VS Code',
  vscode: 'VS Code',
  Code: 'VS Code',
  'Code Helper': 'VS Code',
  'com.microsoft.VSCode': 'VS Code',
  Cursor: 'Cursor',
  'Cursor Helper': 'Cursor',
  'com.todesktop.230313mzl4w4u92': 'Cursor',
  Zed: 'Zed',
  'dev.zed.Zed': 'Zed',
  Windsurf: 'Windsurf',
}

const otelEntrypointLabels: Record<string, string> = {
  cli: 'Terminal',
  'claude-vscode': 'VS Code',
  'claude-in-slack': 'Slack',
}

const laptopTargets = new Set(['laptop-remote-control', 'laptop-headless', 'laptop-cloud'])

/**
 * Names a laptop start's worktree folder as the runner does, which is how a session from an
 * older runner is recognised: the runner is a standalone script and cannot share this, so a test
 * keeps the two equal.
 * @param repositoryName The repository's name.
 * @param startId The start's id.
 * @returns The folder name, such as generative-art-0123abcd.
 */
export const startFolderNameOf = (repositoryName: string, startId: string): string => `${repositoryName}-${startId.slice(0, 8)}`

// A cloud session id comes as cse_<id> in the metrics and as session_<id> at the end of the routine's URL.
const cloudIdOf = (value: string): string => {
  const lastSegment = value.slice(value.lastIndexOf('/') + 1).replace(/^cloud:/, '')
  return lastSegment.slice(lastSegment.indexOf('_') + 1)
}

// A bundle id names an app by its last part; a helper process by the app it helps.
const appNameOf = (launchingApp: string): string => {
  const lastPart = launchingApp.includes('.') && !launchingApp.includes(' ') ? (launchingApp.split('.').at(-1) ?? launchingApp) : launchingApp
  return lastPart.replace(/ Helper.*$/, '')
}

const knownName = (names: Record<string, string>, value: string | null): string | null => (value === null ? null : (names[value] ?? null))

/**
 * Builds the function that says what triggered a session: the Dashi board, an app such as
 * CodePilot, an editor, the Agent SDK or a terminal, from what the hook reported, falling back to
 * Claude Code's metric attributes.
 * @param starts The board's starts in the period.
 * @returns The function from a session and its launch hint to a label.
 */
export const triggerLabelerFor = (starts: UsageStart[]) => {
  const startsById = new Map(starts.map((start) => [start.startId, start]))
  const laptopFolders = new Set(
    starts.filter((start) => laptopTargets.has(start.target)).map((start) => startFolderNameOf(start.repository.name, start.startId)),
  )
  const boardCloudIds = new Set(starts.flatMap((start) => (start.sessionUrl === null ? [] : [cloudIdOf(start.sessionUrl)])))

  const boardLabelOf = (session: StoredSession | undefined, launchHint: string | null): string | null => {
    const startId = session?.origin.startId ?? null
    if (startId !== null) {
      const target = startsById.get(startId)?.target
      return target === undefined || laptopTargets.has(target) ? 'Dashi board (laptop runner)' : 'Dashi board (Claude cloud)'
    }
    const folder = session?.folder ?? null
    if (folder !== null && laptopFolders.has(folder)) return 'Dashi board (laptop runner)'
    if (launchHint?.startsWith('cloud:')) return boardCloudIds.has(cloudIdOf(launchHint)) ? 'Dashi board (Claude cloud)' : 'Claude cloud'
    return null
  }

  const reportedLabelOf = (session: StoredSession | undefined): string | null => {
    if (session === undefined) return null
    const { launcher, terminal, launchingApp } = session.origin
    const editor = knownName(editorNames, launchingApp) ?? knownName(editorNames, launcher) ?? knownName(editorNames, terminal)
    if (editor !== null) return editor
    const terminalName = knownName(terminalNames, launchingApp) ?? knownName(terminalNames, terminal)
    if (launchingApp !== null && terminalName === null) return appNameOf(launchingApp)
    if (launcher?.startsWith('sdk-')) return 'Agent SDK'
    if (launcher === 'cli' || terminalName !== null) return terminalName === null ? 'Terminal' : `Terminal (${terminalName})`
    return launcher
  }

  return (session: StoredSession | undefined, launchHint: string | null): string =>
    boardLabelOf(session, launchHint) ??
    reportedLabelOf(session) ??
    (launchHint === null ? null : (otelEntrypointLabels[launchHint] ?? (launchHint.startsWith('sdk-') ? 'Agent SDK' : launchHint))) ??
    notReportedLabel
}

const providerOf = (apiHost: string | null): string | null => {
  if (apiHost === null || apiHost.endsWith('anthropic.com')) return null
  return apiHost.includes('openrouter') ? 'OpenRouter' : `API key via ${apiHost}`
}

/**
 * Says what paid for a session: a Claude login, an API key, OpenRouter or a cloud provider, from
 * the hook's billing kind, falling back to the account Claude Code's metrics carry.
 * @param session The session the sample belongs to.
 * @param sample One of its token samples, or undefined for a session that has none.
 * @returns The label.
 */
export const billingLabelOf = (
  session: StoredSession | undefined,
  sample: Pick<StoredTokenSample, 'account' | 'machineTokenId'> | undefined,
): string => {
  const account = sample?.account ?? null
  const email = account !== null && !account.startsWith('org:') ? account : null
  const loginLabel = email === null ? 'Claude login' : `Claude login · ${email}`
  switch (session?.origin.billing ?? null) {
    case 'api-key':
      return session?.provider === 'codex' ? 'OpenAI API key' : (providerOf(session?.origin.apiHost ?? null) ?? 'Anthropic API key')
    case 'chatgpt-login':
      return 'ChatGPT login'
    case 'bedrock':
      return 'Amazon Bedrock'
    case 'vertex':
      return 'Google Vertex AI'
    case 'foundry':
      return 'Microsoft Foundry'
    case 'claude-login':
      return loginLabel
    case null:
      break
  }
  if (email !== null) return loginLabel
  if (account !== null) return `Claude organization ${account.slice('org:'.length, 'org:'.length + 8)}`
  // Every sample since Dashi asked carries its machine, so one without it is older than the question.
  return (sample?.machineTokenId ?? null) === null ? notReportedLabel : noClaudeAccountLabel
}

/**
 * Explains a label that needs it: what is missing, or what it may stand for.
 * @param label A trigger or billing label.
 * @returns The note, or null.
 */
export const originNoteOf = (label: string): string | null => {
  if (label === notReportedLabel) return notReportedNote
  return label === noClaudeAccountLabel ? 'An API key or a cloud provider' : null
}
