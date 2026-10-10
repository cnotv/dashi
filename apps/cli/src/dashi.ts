// dashi: connects this machine to a Dashi dashboard in one command. `dashi connect <url>` pairs
// with the dashboard (you approve a short code there, so no token is ever pasted), merges the
// reporting settings into Claude Code's user settings, installs the workflow plugin and, when
// asked, the laptop runner. `dashi doctor` checks all of it again. It needs Node 22.18 or later
// and runs every command as an argument list, never through a shell.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

type Platform = 'macos' | 'linux'

interface ParsedArguments {
  command: string
  positionals: string[]
  flags: Set<string>
}

interface CliPaths {
  home: string
  dashiHome: string
  configPath: string
  claudeSettingsPath: string
  runnerScriptPath: string
  runnerEnvPath: string
  launchAgentPath: string
  systemdUnitPath: string
  runnerLogPath: string
}

interface RunnerFile {
  path: string
  content: string
}

interface CheckResult {
  name: string
  passed: boolean
  detail: string
}

type JsonObject = Record<string, unknown>

const agentBaseMarketplace = 'cnotv'
const agentBaseRepository = 'cnotv/agent-base'
const workflowPlugin = `workflow@${agentBaseMarketplace}`
const launchAgentLabel = 'dev.dashi.runner'
// The label the runner had before the app was renamed to Dashi; its agent is removed on install so
// two runners never poll with the same token.
const previousLaunchAgentLabel = 'dev.agent-dashboard.runner'
const systemdUnitName = 'dashi-runner'
const pairingPollMilliseconds = 2000
const minimumNodeVersion: [number, number] = [22, 18]
// The keys connect writes into the env block, and disconnect removes; nothing else there is touched.
const dashiEnvironmentKeys = [
  'DASHI_URL',
  'DASHI_TOKEN',
  'CLAUDE_CODE_ENABLE_TELEMETRY',
  'OTEL_METRICS_EXPORTER',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_METRICS_INCLUDE_ENTRYPOINT',
]

const usage = `dashi: connect this machine to a Dashi dashboard

  dashi connect <url> [--runner | --no-runner] [--yes]   pair, set up Claude Code, optionally the runner
  dashi doctor                                           check everything connect set up
  dashi runner install | uninstall | status | logs       the laptop runner on its own
  dashi update                                           download the latest CLI and runner, checked by hash
  dashi disconnect [--yes]                               revoke this machine's tokens and undo connect
`

const isRecord = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Splits the command line into the command, its positional arguments and its --flags.
 * @param argv The arguments after the script's path.
 * @returns The parsed arguments; the command is help when none is given.
 */
export const parseArguments = (argv: string[]): ParsedArguments => {
  const flags = new Set(argv.filter((argument) => argument.startsWith('--')).map((argument) => argument.slice(2)))
  const [command = 'help', ...positionals] = argv.filter((argument) => !argument.startsWith('--'))
  return { command, positionals, flags }
}

/**
 * Names the platform as the dashboard does.
 * @param nodePlatform What process.platform says.
 * @returns macos or linux, or null for one the runner does not support.
 */
export const platformOf = (nodePlatform: string): Platform | null => {
  if (nodePlatform === 'darwin') return 'macos'
  return nodePlatform === 'linux' ? 'linux' : null
}

/**
 * Works out where everything connect writes lives, under the given home.
 * @param home The user's home folder.
 * @param claudeConfigDirectory Claude Code's config folder when CLAUDE_CONFIG_DIR sets one.
 * @returns The paths.
 */
export const cliPathsFor = (home: string, claudeConfigDirectory: string | undefined): CliPaths => {
  const dashiHome = join(home, 'dashi')
  return {
    home,
    dashiHome,
    configPath: join(dashiHome, 'config.json'),
    claudeSettingsPath: join(claudeConfigDirectory ?? join(home, '.claude'), 'settings.json'),
    runnerScriptPath: join(dashiHome, 'runner.ts'),
    runnerEnvPath: join(dashiHome, 'runner.env'),
    launchAgentPath: join(home, 'Library', 'LaunchAgents', `${launchAgentLabel}.plist`),
    systemdUnitPath: join(home, '.config', 'systemd', 'user', `${systemdUnitName}.service`),
    runnerLogPath: join(dashiHome, 'runner.log'),
  }
}

/**
 * Normalises a dashboard address: https unless it is local, and without a trailing slash.
 * @param typedUrl The address as typed.
 * @returns The address, or null when it is not one.
 */
export const dashboardUrlFrom = (typedUrl: string): string | null => {
  const isLocalAddress = /^(localhost|127\.0\.0\.1)(:|\/|$)/.test(typedUrl)
  const withScheme = /^https?:\/\//.test(typedUrl) ? typedUrl : `${isLocalAddress ? 'http' : 'https'}://${typedUrl}`
  try {
    const parsed = new URL(withScheme)
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
    if (parsed.protocol === 'http:' && !isLocal) return null
    return parsed.origin
  } catch {
    return null
  }
}

/**
 * The settings that make Claude Code report to the dashboard: the workflow plugin, whose hook posts
 * each session event, the hook's address and token, and Claude Code's token metrics. They go in the
 * user's own settings, the only place Claude Code reads telemetry settings from.
 * @param dashboardUrl The dashboard's address.
 * @param ingestToken This machine's ingest token.
 * @returns The keys to merge into ~/.claude/settings.json.
 */
export const claudeSettingsFor = (dashboardUrl: string, ingestToken: string): JsonObject => ({
  extraKnownMarketplaces: { [agentBaseMarketplace]: { source: { source: 'github', repo: agentBaseRepository } } },
  enabledPlugins: { [workflowPlugin]: true },
  env: {
    DASHI_URL: dashboardUrl,
    DASHI_TOKEN: ingestToken,
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_ENDPOINT: `${dashboardUrl}/api/telemetry`,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${ingestToken}`,
    // Off by default; Usage needs it to tell a terminal session from VS Code or the Agent SDK.
    OTEL_METRICS_INCLUDE_ENTRYPOINT: 'true',
  },
})

const objectAt = (settings: JsonObject, key: string): JsonObject => {
  const value = settings[key]
  return isRecord(value) ? value : {}
}

/**
 * Merges the dashboard's settings into the user's, one level deep, leaving every other key as it is.
 * @param existing The user's settings.
 * @param dashiSettings What claudeSettingsFor returns.
 * @returns The merged settings.
 */
export const mergeClaudeSettings = (existing: JsonObject, dashiSettings: JsonObject): JsonObject =>
  Object.entries(dashiSettings).reduce<JsonObject>(
    (merged, [key, value]) => ({ ...merged, [key]: isRecord(value) ? { ...objectAt(existing, key), ...value } : value }),
    existing,
  )

/**
 * Takes the dashboard's variables out of the user's settings; the plugin stays, it is useful alone.
 * @param existing The user's settings.
 * @returns The settings without them.
 */
export const withoutDashiSettings = (existing: JsonObject): JsonObject => ({
  ...existing,
  env: Object.fromEntries(Object.entries(objectAt(existing, 'env')).filter(([key]) => !dashiEnvironmentKeys.includes(key))),
})

const maskedValue = (key: string, value: unknown): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (key === 'DASHI_TOKEN') return `${text.slice(0, 8)}…`
  return key === 'OTEL_EXPORTER_OTLP_HEADERS' ? text.replace(/(Bearer .{4}).+/, '$1…') : text
}

/**
 * Lists what a merge changes, with tokens shortened, to show before writing the file.
 * @param before The settings now.
 * @param after The settings after the merge.
 * @returns One line per added or changed key.
 */
export const settingsChangesOf = (before: JsonObject, after: JsonObject): string[] =>
  Object.keys(after).flatMap((key) => {
    const beforeValue = before[key]
    const afterValue = after[key]
    if (isRecord(afterValue)) {
      const beforeObject = isRecord(beforeValue) ? beforeValue : {}
      return Object.entries(afterValue)
        .filter(([innerKey, innerValue]) => JSON.stringify(beforeObject[innerKey]) !== JSON.stringify(innerValue))
        .map(([innerKey, innerValue]) => `${key}.${innerKey} = ${maskedValue(innerKey, innerValue)}`)
    }
    return JSON.stringify(beforeValue) === JSON.stringify(afterValue) ? [] : [`${key} = ${maskedValue(key, afterValue)}`]
  })

/**
 * Reads a settings file, treating a missing one as empty.
 * @param settingsPath The file.
 * @returns The settings, or the reason the file cannot be used.
 */
export const readSettingsFile = (settingsPath: string): JsonObject | string => {
  if (!existsSync(settingsPath)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'))
    return isRecord(parsed) ? parsed : `${settingsPath} is not a JSON object`
  } catch {
    return `${settingsPath} is not valid JSON; fix it by hand, then run dashi connect again`
  }
}

const xmlEscaped = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

// Plain key characters only, so a key can neither end its line in the env file nor its string in the plist.
const openRouterKeyPattern = /^[A-Za-z0-9_-]{8,512}$/

/**
 * The OpenRouter key the runner gets, for the sessions started from the board on an OpenRouter
 * model: the one in this shell, else the one an earlier install left.
 * @param shellKey OPENROUTER_API_KEY in this shell.
 * @param installedKey The key the installed runner has.
 * @returns The key, or null when there is none fit to write.
 */
export const runnerOpenRouterKeyOf = (shellKey: string | undefined, installedKey: string | null): string | null =>
  [shellKey, installedKey].find((key) => key !== undefined && key !== null && openRouterKeyPattern.test(key)) ?? null

/**
 * The files that run the laptop runner as a service: a login agent on macOS, whose plist carries
 * its token as launchd has no env files; a systemd user service on Linux, whose token sits in its
 * own file. Both readable by this user only. The OpenRouter key, when there is one, goes beside the token.
 * @param platform The platform.
 * @param paths Where the files go.
 * @param input The dashboard, the runner token, the OpenRouter key, node's path and the PATH the runner needs.
 * @returns The files to write.
 */
export const runnerServiceFilesFor = (
  platform: Platform,
  paths: CliPaths,
  input: { dashboardUrl: string; runnerToken: string; openRouterKey: string | null; nodePath: string; searchPath: string },
): RunnerFile[] => {
  if (platform === 'macos') {
    const plist = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0"><dict>',
      `  <key>Label</key><string>${launchAgentLabel}</string>`,
      `  <key>ProgramArguments</key><array><string>${xmlEscaped(input.nodePath)}</string><string>${xmlEscaped(paths.runnerScriptPath)}</string></array>`,
      '  <key>EnvironmentVariables</key><dict>',
      `    <key>DASHI_URL</key><string>${xmlEscaped(input.dashboardUrl)}</string>`,
      `    <key>DASHI_RUNNER_TOKEN</key><string>${xmlEscaped(input.runnerToken)}</string>`,
      ...(input.openRouterKey === null ? [] : [`    <key>OPENROUTER_API_KEY</key><string>${xmlEscaped(input.openRouterKey)}</string>`]),
      `    <key>PATH</key><string>${xmlEscaped(input.searchPath)}</string>`,
      '  </dict>',
      '  <key>RunAtLoad</key><true/>',
      '  <key>KeepAlive</key><true/>',
      `  <key>StandardOutPath</key><string>${xmlEscaped(paths.runnerLogPath)}</string>`,
      `  <key>StandardErrorPath</key><string>${xmlEscaped(paths.runnerLogPath)}</string>`,
      '</dict></plist>',
      '',
    ].join('\n')
    return [{ path: paths.launchAgentPath, content: plist }]
  }
  const unit = [
    '[Unit]',
    'Description=Dashi laptop runner',
    'After=network-online.target',
    '',
    '[Service]',
    `EnvironmentFile=${paths.runnerEnvPath}`,
    `Environment=PATH=${input.searchPath}`,
    `ExecStart=${input.nodePath} ${paths.runnerScriptPath}`,
    'Restart=always',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')
  const openRouterLine = input.openRouterKey === null ? '' : `OPENROUTER_API_KEY=${input.openRouterKey}\n`
  const environmentFile = `DASHI_URL=${input.dashboardUrl}\nDASHI_RUNNER_TOKEN=${input.runnerToken}\n${openRouterLine}`
  return [
    { path: paths.runnerEnvPath, content: environmentFile },
    { path: paths.systemdUnitPath, content: unit },
  ]
}

/**
 * Finds a variable an earlier install gave the runner, in the plist on macOS or the env file on Linux.
 * @param platform The platform.
 * @param paths Where the files are.
 * @param name The variable: the runner token, or the OpenRouter key.
 * @returns Its value, or null when the runner is not installed or has no such variable.
 */
export const installedRunnerSettingOf = (platform: Platform, paths: CliPaths, name: 'DASHI_RUNNER_TOKEN' | 'OPENROUTER_API_KEY'): string | null => {
  const sourcePath = platform === 'macos' ? paths.launchAgentPath : paths.runnerEnvPath
  if (!existsSync(sourcePath)) return null
  const content = readFileSync(sourcePath, 'utf8')
  const settingMatch =
    platform === 'macos' ? new RegExp(`<key>${name}</key><string>([^<]+)</string>`).exec(content) : new RegExp(`^${name}=(.+)$`, 'm').exec(content)
  return settingMatch?.[1] ?? null
}

/**
 * Compares two Node versions as major and minor.
 * @param version process.versions.node.
 * @returns True when it is at least the version the runner needs.
 */
export const isSupportedNode = (version: string): boolean => {
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > minimumNodeVersion[0] || (major === minimumNodeVersion[0] && minor >= minimumNodeVersion[1])
}

/**
 * Formats the doctor's results, one line each, with the fix under a failure.
 * @param results The checks.
 * @returns The report.
 */
export const doctorReport = (results: CheckResult[]): string =>
  results.map((result) => `${result.passed ? 'ok  ' : 'FAIL'} ${result.name}${result.detail === '' ? '' : `\n     ${result.detail}`}`).join('\n')

const say = (text: string): void => {
  process.stdout.write(`${text}\n`)
}

const findOnPath = (program: string): string | null =>
  (process.env.PATH ?? '')
    .split(delimiter)
    .filter((folder) => folder !== '')
    .map((folder) => join(folder, program))
    .find((candidate) => existsSync(candidate)) ?? null

const runQuietly = (program: string, args: string[]): { ok: boolean; output: string } => {
  const result = spawnSync(program, args, { encoding: 'utf8' })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

const writePrivateFile = (filePath: string, content: string): void => {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, { mode: 0o600 })
  chmodSync(filePath, 0o600)
}

const confirm = async (question: string, flags: Set<string>): Promise<boolean> => {
  if (flags.has('yes')) return true
  if (!process.stdin.isTTY) throw new Error(`${question} Run again with --yes to answer yes without asking.`)
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await readline.question(`${question} [y/N] `)
  readline.close()
  return /^y(es)?$/i.test(answer.trim())
}

const requestJson = async (url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
  return { status: response.status, body: await response.json().catch(() => null) }
}

const errorOf = (body: unknown, fallback: string): string => (isRecord(body) && typeof body.error === 'string' ? body.error : fallback)

const openInBrowser = (url: string, platform: Platform): void => {
  spawnSync(platform === 'macos' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' })
}

const readDashboardUrl = (paths: CliPaths): string => {
  const config: unknown = existsSync(paths.configPath) ? JSON.parse(readFileSync(paths.configPath, 'utf8')) : null
  if (!isRecord(config) || typeof config.dashboardUrl !== 'string') throw new Error('This machine is not connected yet; run dashi connect <url> first')
  return config.dashboardUrl
}

const ingestTokenOf = (paths: CliPaths): string | null => {
  const settings = readSettingsFile(paths.claudeSettingsPath)
  const token = typeof settings === 'string' ? undefined : objectAt(settings, 'env').DASHI_TOKEN
  return typeof token === 'string' ? token : null
}

/**
 * Downloads a script the dashboard serves and keeps it only when it matches the hash the dashboard
 * publishes for it.
 * @param dashboardUrl The dashboard.
 * @param scriptPath The script's path, such as /api/runner/script; its hash is at <path>-info.
 * @param destination Where to save it.
 * @returns The SHA-256 it matched.
 */
const downloadChecked = async (dashboardUrl: string, scriptPath: string, destination: string): Promise<string> => {
  const info = await requestJson(`${dashboardUrl}${scriptPath}-info`)
  const expectedHash = isRecord(info.body) && typeof info.body.sha256 === 'string' ? info.body.sha256 : null
  if (expectedHash === null) throw new Error(`The dashboard published no hash for ${scriptPath}; update it, then try again`)
  const scriptResponse = await fetch(`${dashboardUrl}${scriptPath}`, { signal: AbortSignal.timeout(30000) })
  const script = Buffer.from(await scriptResponse.arrayBuffer())
  const actualHash = createHash('sha256').update(script).digest('hex')
  if (actualHash !== expectedHash) throw new Error(`The downloaded ${scriptPath} does not match the hash the dashboard published; nothing was installed`)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, script, { mode: 0o644 })
  return actualHash
}

const pairWithDashboard = async (dashboardUrl: string, platform: Platform, withRunner: boolean): Promise<{ label: string; ingestToken: string; runnerToken: string | null }> => {
  const created = await requestJson(`${dashboardUrl}/api/pairings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostname: hostname().replace(/[^A-Za-z0-9._ -]/g, '-').slice(0, 100) || 'machine', platform }),
  })
  const pairing = created.body
  if (created.status !== 201 || !isRecord(pairing) || typeof pairing.pairingId !== 'string' || typeof pairing.pollSecret !== 'string') {
    throw new Error(errorOf(pairing, `The dashboard answered ${created.status} when asked to pair`))
  }
  const approveUrl = `${dashboardUrl}${String(pairing.approvePath)}`
  say(`\nApprove this machine in Dashi with the code  ${String(pairing.userCode)}`)
  say(`  ${approveUrl}`)
  if (withRunner) say('  Tick "Also run the sessions I start from the board" there to set up the runner too.')
  openInBrowser(approveUrl, platform)
  const poll = async (): Promise<{ label: string; ingestToken: string; runnerToken: string | null }> => {
    await new Promise((resolveWait) => setTimeout(resolveWait, pairingPollMilliseconds))
    const answer = await requestJson(`${dashboardUrl}/api/pairings/${String(pairing.pairingId)}`, {
      headers: { Authorization: `Bearer ${String(pairing.pollSecret)}` },
    })
    const body = answer.body
    if (answer.status !== 200) throw new Error(errorOf(body, `The dashboard answered ${answer.status} while waiting for approval`))
    if (isRecord(body) && body.state === 'approved' && typeof body.ingestToken === 'string' && typeof body.label === 'string') {
      return { label: body.label, ingestToken: body.ingestToken, runnerToken: typeof body.runnerToken === 'string' ? body.runnerToken : null }
    }
    return poll()
  }
  say('Waiting for approval…')
  return poll()
}

const writeClaudeSettings = async (paths: CliPaths, dashboardUrl: string, ingestToken: string, flags: Set<string>): Promise<void> => {
  const existing = readSettingsFile(paths.claudeSettingsPath)
  if (typeof existing === 'string') throw new Error(existing)
  const merged = mergeClaudeSettings(existing, claudeSettingsFor(dashboardUrl, ingestToken))
  const changes = settingsChangesOf(existing, merged)
  if (changes.length === 0) {
    say(`ok   ${paths.claudeSettingsPath} already reports to this dashboard`)
    return
  }
  say(`\nThese settings go into ${paths.claudeSettingsPath}:`)
  changes.forEach((change) => say(`  ${change}`))
  if (!(await confirm('Write them?', flags))) throw new Error('Left the Claude Code settings as they were; nothing will report until they are written')
  if (existsSync(paths.claudeSettingsPath)) {
    const backupPath = `${paths.claudeSettingsPath}.before-dashi-${new Date().toISOString().replace(/[:.]/g, '-')}`
    copyFileSync(paths.claudeSettingsPath, backupPath)
    chmodSync(backupPath, 0o600)
    say(`     the old file is kept as ${backupPath}`)
  }
  writePrivateFile(paths.claudeSettingsPath, `${JSON.stringify(merged, null, 2)}\n`)
  say(`ok   wrote ${paths.claudeSettingsPath}`)
}

const installPlugin = (): void => {
  const marketplace = runQuietly('claude', ['plugin', 'marketplace', 'add', agentBaseRepository])
  const plugin = runQuietly('claude', ['plugin', 'install', workflowPlugin])
  const alreadyThere = (output: string): boolean => /already/i.test(output)
  if ((marketplace.ok || alreadyThere(marketplace.output)) && (plugin.ok || alreadyThere(plugin.output))) {
    say(`ok   the ${workflowPlugin} plugin is installed`)
    return
  }
  say(`FAIL could not install the ${workflowPlugin} plugin:\n     ${plugin.output || marketplace.output}`)
  say(`     Claude Code installs it on its next start from the settings; or run: claude plugin install ${workflowPlugin}`)
}

const runnerSearchPath = (nodePath: string): string =>
  [dirname(nodePath), ...['claude', 'git', 'tmux'].map(findOnPath).filter((found) => found !== null).map(dirname), '/usr/local/bin', '/usr/bin', '/bin']
    .filter((folder, index, folders) => folders.indexOf(folder) === index)
    .join(':')

/**
 * The launchctl calls that (re)start the runner's login agent, as argument lists: check the plist,
 * stop the agents of this and the pre-rename label, wait until launchd has let go of the job, then
 * load it. bootout returns before the old job is gone, and bootstrapping a label launchd still
 * holds fails with "Bootstrap failed: 5", hence the wait.
 * @param userId The user's numeric id, whose GUI session the agent runs in.
 * @param launchAgentPath The plist.
 * @returns The calls, in order.
 */
export const launchAgentStartSteps = (userId: number, launchAgentPath: string) => {
  const domain = `gui/${userId}`
  return {
    lint: ['plutil', '-lint', launchAgentPath],
    bootouts: [previousLaunchAgentLabel, launchAgentLabel].map((label) => ['launchctl', 'bootout', `${domain}/${label}`]),
    isLoaded: ['launchctl', 'print', `${domain}/${launchAgentLabel}`],
    bootstrap: ['launchctl', 'bootstrap', domain, launchAgentPath],
  }
}

const runArgumentList = ([program = '', ...args]: string[]): { ok: boolean; output: string } => runQuietly(program, args)

const waitUntilUnloaded = (isLoaded: string[], secondsLeft: number): void => {
  if (secondsLeft === 0 || !runArgumentList(isLoaded).ok) return
  spawnSync('sleep', ['1'])
  waitUntilUnloaded(isLoaded, secondsLeft - 1)
}

const startLaunchAgent = (paths: CliPaths): void => {
  const steps = launchAgentStartSteps(process.getuid?.() ?? 0, paths.launchAgentPath)
  const lint = runArgumentList(steps.lint)
  if (!lint.ok) throw new Error(`The runner's login agent file is not a valid plist: ${lint.output}`)
  steps.bootouts.forEach((bootout) => runArgumentList(bootout))
  rmSync(join(dirname(paths.launchAgentPath), `${previousLaunchAgentLabel}.plist`), { force: true })
  waitUntilUnloaded(steps.isLoaded, 10)
  const bootstrap = runArgumentList(steps.bootstrap)
  if (!bootstrap.ok) {
    throw new Error(
      `launchctl could not start the runner: ${bootstrap.output}\n` +
        '     If an older runner was still stopping, run dashi runner install again. Run it in Terminal on the Mac itself:\n' +
        '     launchd starts login agents only inside a GUI login, not over SSH.',
    )
  }
}

const startRunnerService = (platform: Platform, paths: CliPaths): void => {
  if (platform === 'macos') {
    startLaunchAgent(paths)
    return
  }
  runQuietly('systemctl', ['--user', 'daemon-reload'])
  const enable = runQuietly('systemctl', ['--user', 'enable', '--now', systemdUnitName])
  if (!enable.ok) throw new Error(`systemctl could not start the runner: ${enable.output}`)
}

const installRunner = async (platform: Platform, paths: CliPaths, dashboardUrl: string, runnerToken: string): Promise<void> => {
  const sha256 = await downloadChecked(dashboardUrl, '/api/runner/script', paths.runnerScriptPath)
  say(`ok   downloaded the runner, SHA-256 ${sha256}`)
  const nodePath = process.execPath
  const openRouterKey = runnerOpenRouterKeyOf(process.env.OPENROUTER_API_KEY, installedRunnerSettingOf(platform, paths, 'OPENROUTER_API_KEY'))
  runnerServiceFilesFor(platform, paths, { dashboardUrl, runnerToken, openRouterKey, nodePath, searchPath: runnerSearchPath(nodePath) }).forEach(
    (file) => writePrivateFile(file.path, file.content),
  )
  startRunnerService(platform, paths)
  say(openRouterStatusLine(openRouterKey !== null))
  say(
    platform === 'macos'
      ? `ok   the runner starts with the Mac; its log is ${paths.runnerLogPath}`
      : `ok   the runner runs as the ${systemdUnitName} user service; its log is journalctl --user -u ${systemdUnitName}\n     to keep it running after you log out: loginctl enable-linger $USER`,
  )
}

const openRouterStatusLine = (hasOpenRouterKey: boolean): string =>
  hasOpenRouterKey
    ? 'ok   the runner has OPENROUTER_API_KEY, for unattended starts on an OpenRouter model'
    : '     starts on an OpenRouter model need OPENROUTER_API_KEY: export it, then run dashi runner install'

const uninstallRunner = (platform: Platform, paths: CliPaths): void => {
  if (platform === 'macos') {
    runQuietly('launchctl', ['bootout', `gui/${process.getuid?.() ?? ''}/${launchAgentLabel}`])
    rmSync(paths.launchAgentPath, { force: true })
  } else {
    runQuietly('systemctl', ['--user', 'disable', '--now', systemdUnitName])
    rmSync(paths.systemdUnitPath, { force: true })
    rmSync(paths.runnerEnvPath, { force: true })
    runQuietly('systemctl', ['--user', 'daemon-reload'])
  }
  say('ok   the runner is uninstalled')
}

const whoami = async (dashboardUrl: string, token: string): Promise<CheckResult> => {
  const answer = await requestJson(`${dashboardUrl}/api/machine/whoami`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null)
  const body = answer?.body
  if (answer?.status === 200 && isRecord(body)) {
    return { name: `the dashboard accepts the ${String(body.kind)} token for ${String(body.label)}`, passed: true, detail: '' }
  }
  return { name: 'token', passed: false, detail: 'the dashboard no longer accepts it; run dashi connect again' }
}

const preflightChecks = (platform: Platform, withRunner: boolean): CheckResult[] => [
  {
    name: `Node ${process.versions.node}`,
    passed: isSupportedNode(process.versions.node),
    detail: isSupportedNode(process.versions.node) ? '' : `needs ${minimumNodeVersion.join('.')} or later`,
  },
  { name: 'git', passed: findOnPath('git') !== null, detail: findOnPath('git') === null ? 'install git' : '' },
  {
    name: 'Claude Code',
    passed: findOnPath('claude') !== null,
    detail: findOnPath('claude') === null ? 'install Claude Code and log in: https://claude.com/claude-code' : '',
  },
  ...(withRunner
    ? [
        {
          name: 'tmux, for sessions steered from the phone',
          passed: findOnPath('tmux') !== null,
          detail: findOnPath('tmux') === null ? (platform === 'macos' ? 'brew install tmux' : 'sudo apt install tmux') : '',
        },
      ]
    : []),
]

const connect = async (parsed: ParsedArguments, platform: Platform, paths: CliPaths): Promise<void> => {
  const dashboardUrl = dashboardUrlFrom(parsed.positionals[0] ?? '')
  if (dashboardUrl === null) throw new Error('Give the dashboard address: dashi connect https://dash.example.com')
  const preflight = preflightChecks(platform, !parsed.flags.has('no-runner'))
  say(doctorReport(preflight))
  if (preflight.slice(0, 3).some((check) => !check.passed)) throw new Error('Fix the checks above, then run dashi connect again')
  const health = await requestJson(`${dashboardUrl}/api/health`).catch(() => null)
  if (health?.status !== 200) throw new Error(`${dashboardUrl} does not answer as a Dashi dashboard`)
  say(`ok   ${dashboardUrl} answers`)

  const withRunner = parsed.flags.has('runner')
    ? true
    : parsed.flags.has('no-runner')
      ? false
      : await confirm('Also run the sessions you start from the board on this machine (the laptop runner)?', parsed.flags)
  const paired = await pairWithDashboard(dashboardUrl, platform, withRunner)
  say(`ok   approved as ${paired.label}`)
  writePrivateFile(paths.configPath, `${JSON.stringify({ dashboardUrl }, null, 2)}\n`)

  await writeClaudeSettings(paths, dashboardUrl, paired.ingestToken, parsed.flags)
  installPlugin()
  if (paired.runnerToken !== null) await installRunner(platform, paths, dashboardUrl, paired.runnerToken)
  else if (withRunner) say('     the runner was not ticked when approving; run dashi connect again with --runner to add it')

  const tokenChecks = await Promise.all([paired.ingestToken, paired.runnerToken].filter((token) => token !== null).map((token) => whoami(dashboardUrl, token)))
  say(doctorReport(tokenChecks))
  say('\nDone. Start any Claude Code session on this machine; it appears on the dashboard\'s Sessions page. dashi doctor checks it all again.')
}

const doctor = async (platform: Platform, paths: CliPaths): Promise<void> => {
  const dashboardUrl = readDashboardUrl(paths)
  const settings = readSettingsFile(paths.claudeSettingsPath)
  const ingestToken = ingestTokenOf(paths)
  const runnerToken = installedRunnerSettingOf(platform, paths, 'DASHI_RUNNER_TOKEN')
  const pluginEnabled = typeof settings !== 'string' && objectAt(settings, 'enabledPlugins')[workflowPlugin] === true
  const health = await requestJson(`${dashboardUrl}/api/health`).catch(() => null)
  const runnerState =
    runnerToken === null
      ? null
      : platform === 'macos'
        ? runQuietly('launchctl', ['print', `gui/${process.getuid?.() ?? ''}/${launchAgentLabel}`]).ok
        : runQuietly('systemctl', ['--user', 'is-active', systemdUnitName]).ok
  const results: CheckResult[] = [
    ...preflightChecks(platform, runnerToken !== null),
    { name: `${dashboardUrl} answers`, passed: health?.status === 200, detail: health?.status === 200 ? '' : 'check the address and that the dashboard is up' },
    {
      name: `Claude Code settings report to ${dashboardUrl}`,
      passed: ingestToken !== null && typeof settings !== 'string' && objectAt(settings, 'env').DASHI_URL === dashboardUrl,
      detail: ingestToken === null ? `run dashi connect ${dashboardUrl}` : '',
    },
    { name: `${workflowPlugin} plugin enabled`, passed: pluginEnabled, detail: pluginEnabled ? '' : `run claude plugin install ${workflowPlugin}` },
    ...(ingestToken === null ? [] : [await whoami(dashboardUrl, ingestToken)]),
    ...(runnerToken === null
      ? []
      : [
          await whoami(dashboardUrl, runnerToken),
          { name: 'runner service running', passed: runnerState === true, detail: runnerState === true ? '' : 'run dashi runner install' },
        ]),
  ]
  say(doctorReport(results))
  // Informational only: a machine that never starts on OpenRouter needs no key.
  if (runnerToken !== null) say(openRouterStatusLine(installedRunnerSettingOf(platform, paths, 'OPENROUTER_API_KEY') !== null))
  if (results.some((result) => !result.passed)) process.exitCode = 1
}

const runnerCommand = async (parsed: ParsedArguments, platform: Platform, paths: CliPaths): Promise<void> => {
  const action = parsed.positionals[0] ?? 'status'
  if (action === 'install') {
    const runnerToken = installedRunnerSettingOf(platform, paths, 'DASHI_RUNNER_TOKEN')
    if (runnerToken === null) throw new Error('No runner token on this machine yet; run dashi connect <url> --runner')
    await installRunner(platform, paths, readDashboardUrl(paths), runnerToken)
    return
  }
  if (action === 'uninstall') {
    uninstallRunner(platform, paths)
    return
  }
  if (action === 'logs') {
    spawnSync(platform === 'macos' ? 'tail' : 'journalctl', platform === 'macos' ? ['-n', '100', paths.runnerLogPath] : ['--user', '-u', systemdUnitName, '-n', '100', '--no-pager'], {
      stdio: 'inherit',
    })
    return
  }
  const status =
    platform === 'macos'
      ? runQuietly('launchctl', ['print', `gui/${process.getuid?.() ?? ''}/${launchAgentLabel}`])
      : runQuietly('systemctl', ['--user', 'status', systemdUnitName, '--no-pager'])
  say(status.ok ? status.output : 'The runner is not installed or not running; dashi runner install sets it up')
}

const update = async (platform: Platform, paths: CliPaths): Promise<void> => {
  const dashboardUrl = readDashboardUrl(paths)
  const cliPath = fileURLToPath(import.meta.url)
  const cliHash = await downloadChecked(dashboardUrl, '/api/cli/script', cliPath)
  say(`ok   updated dashi, SHA-256 ${cliHash}`)
  const runnerToken = installedRunnerSettingOf(platform, paths, 'DASHI_RUNNER_TOKEN')
  if (runnerToken !== null) await installRunner(platform, paths, dashboardUrl, runnerToken)
}

const disconnect = async (parsed: ParsedArguments, platform: Platform, paths: CliPaths): Promise<void> => {
  const dashboardUrl = readDashboardUrl(paths)
  if (!(await confirm(`Revoke this machine's tokens on ${dashboardUrl} and remove what dashi connect set up?`, parsed.flags))) return
  const tokens = [ingestTokenOf(paths), installedRunnerSettingOf(platform, paths, 'DASHI_RUNNER_TOKEN')].filter((token) => token !== null)
  await Promise.all(
    tokens.map((token) =>
      requestJson(`${dashboardUrl}/api/machine/whoami`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      }).catch(() => null),
    ),
  )
  say(`ok   revoked ${tokens.length} token${tokens.length === 1 ? '' : 's'}`)
  const settings = readSettingsFile(paths.claudeSettingsPath)
  if (typeof settings !== 'string' && existsSync(paths.claudeSettingsPath)) {
    writePrivateFile(paths.claudeSettingsPath, `${JSON.stringify(withoutDashiSettings(settings), null, 2)}\n`)
    say(`ok   removed the dashboard's variables from ${paths.claudeSettingsPath}`)
  }
  if (installedRunnerSettingOf(platform, paths, 'DASHI_RUNNER_TOKEN') !== null) uninstallRunner(platform, paths)
  rmSync(paths.configPath, { force: true })
}

const main = async (argv: string[]): Promise<void> => {
  const parsed = parseArguments(argv)
  if (parsed.command === 'help' || parsed.flags.has('help')) {
    say(usage)
    return
  }
  const platform = platformOf(process.platform)
  if (platform === null) throw new Error(`dashi supports macOS and Linux; this is ${process.platform}`)
  const paths = cliPathsFor(homedir(), process.env.CLAUDE_CONFIG_DIR)
  if (parsed.command === 'connect') return connect(parsed, platform, paths)
  if (parsed.command === 'doctor') return doctor(platform, paths)
  if (parsed.command === 'runner') return runnerCommand(parsed, platform, paths)
  if (parsed.command === 'update') return update(platform, paths)
  if (parsed.command === 'disconnect') return disconnect(parsed, platform, paths)
  say(usage)
  process.exitCode = 1
}

const isRunDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isRunDirectly) {
  main(process.argv.slice(2)).catch((runError: unknown) => {
    process.stderr.write(`dashi: ${runError instanceof Error ? runError.message : String(runError)}\n`)
    process.exitCode = 1
  })
}
