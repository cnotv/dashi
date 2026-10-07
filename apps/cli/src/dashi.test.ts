import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claudeSettingsFor,
  cliPathsFor,
  dashboardUrlFrom,
  doctorReport,
  installedRunnerTokenOf,
  isSupportedNode,
  launchAgentStartSteps,
  mergeClaudeSettings,
  parseArguments,
  platformOf,
  readSettingsFile,
  runnerServiceFilesFor,
  settingsChangesOf,
  withoutDashiSettings,
} from './dashi.ts'

const dashboardUrl = 'https://dash.example.com'
const ingestToken = 'dashi_ingest_0123456789abcdef'
const runnerToken = 'dashi_runner_fedcba9876543210'

describe('parseArguments', () => {
  it('splits the command, its positionals and its flags', () => {
    expect(parseArguments(['connect', 'dash.example.com', '--runner', '--yes'])).toEqual({
      command: 'connect',
      positionals: ['dash.example.com'],
      flags: new Set(['runner', 'yes']),
    })
  })

  it('falls back to help', () => {
    expect(parseArguments([]).command).toBe('help')
  })
})

describe('platformOf', () => {
  it('names macOS and Linux, and nothing else', () => {
    expect(platformOf('darwin')).toBe('macos')
    expect(platformOf('linux')).toBe('linux')
    expect(platformOf('win32')).toBeNull()
  })
})

describe('dashboardUrlFrom', () => {
  it('adds https and drops paths and trailing slashes', () => {
    expect(dashboardUrlFrom('dash.example.com/')).toBe(dashboardUrl)
    expect(dashboardUrlFrom('https://dash.example.com/sessions')).toBe(dashboardUrl)
  })

  it('accepts plain http only for this machine', () => {
    expect(dashboardUrlFrom('http://localhost:8787')).toBe('http://localhost:8787')
    expect(dashboardUrlFrom('localhost:8787')).toBe('http://localhost:8787')
    expect(dashboardUrlFrom('http://dash.example.com')).toBeNull()
  })

  it('refuses what is not an address', () => {
    expect(dashboardUrlFrom('')).toBeNull()
    expect(dashboardUrlFrom('https://')).toBeNull()
  })
})

describe('Claude Code settings', () => {
  const existing = {
    model: 'opus',
    enabledPlugins: { 'other@market': true },
    env: { EDITOR: 'vim', DASHI_URL: 'https://old.example.com' },
  }

  it('reports to the dashboard with the ingest token for hooks and metrics alike', () => {
    const settings = claudeSettingsFor(dashboardUrl, ingestToken)
    expect(settings.enabledPlugins).toEqual({ 'workflow@cnotv': true })
    expect(settings.env).toMatchObject({
      DASHI_URL: dashboardUrl,
      DASHI_TOKEN: ingestToken,
      OTEL_EXPORTER_OTLP_ENDPOINT: `${dashboardUrl}/api/telemetry`,
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${ingestToken}`,
      OTEL_METRICS_INCLUDE_ENTRYPOINT: 'true',
    })
  })

  it('merges one level deep and keeps every other key', () => {
    const merged = mergeClaudeSettings(existing, claudeSettingsFor(dashboardUrl, ingestToken))
    expect(merged.model).toBe('opus')
    expect(merged.enabledPlugins).toEqual({ 'other@market': true, 'workflow@cnotv': true })
    expect(merged.env).toMatchObject({ EDITOR: 'vim', DASHI_URL: dashboardUrl })
  })

  it('lists only what changes, with the token shortened', () => {
    const merged = mergeClaudeSettings(existing, claudeSettingsFor(dashboardUrl, ingestToken))
    const changes = settingsChangesOf(existing, merged)
    expect(changes).toContain(`env.DASHI_URL = ${dashboardUrl}`)
    expect(changes.join('\n')).not.toContain(ingestToken)
    expect(changes).toContain('env.OTEL_EXPORTER_OTLP_HEADERS = Authorization=Bearer dash…')
    expect(changes.some((change) => change.startsWith('env.EDITOR'))).toBe(false)
    expect(settingsChangesOf(merged, merged)).toEqual([])
  })

  it('takes the dashboard variables out again and leaves the rest', () => {
    const merged = mergeClaudeSettings(existing, claudeSettingsFor(dashboardUrl, ingestToken))
    const cleaned = withoutDashiSettings(merged)
    expect(cleaned.env).toEqual({ EDITOR: 'vim' })
    expect(cleaned.model).toBe('opus')
  })
})

describe('readSettingsFile', () => {
  const state = { folder: '' }
  beforeEach(() => {
    state.folder = mkdtempSync(join(tmpdir(), 'dashi-cli-'))
  })
  afterEach(() => {
    rmSync(state.folder, { recursive: true, force: true })
  })

  it('treats a missing file as empty settings', () => {
    expect(readSettingsFile(join(state.folder, 'settings.json'))).toEqual({})
  })

  it('refuses a broken file rather than overwriting it', () => {
    const settingsPath = join(state.folder, 'settings.json')
    writeFileSync(settingsPath, '{ "env": ')
    expect(readSettingsFile(settingsPath)).toMatch(/not valid JSON/)
    writeFileSync(settingsPath, '[]')
    expect(readSettingsFile(settingsPath)).toMatch(/not a JSON object/)
  })

  it('finds the runner token an install left on either platform', () => {
    const paths = cliPathsFor(state.folder, undefined)
    const input = { dashboardUrl, runnerToken, nodePath: '/usr/bin/node', searchPath: '/usr/bin:/bin' }
    expect(installedRunnerTokenOf('linux', paths)).toBeNull()
    const [environmentFile] = runnerServiceFilesFor('linux', paths, input)
    const [plist] = runnerServiceFilesFor('macos', paths, input)
    writeFileSync(join(state.folder, 'runner.env'), environmentFile?.content ?? '')
    expect(installedRunnerTokenOf('linux', { ...paths, runnerEnvPath: join(state.folder, 'runner.env') })).toBe(runnerToken)
    writeFileSync(join(state.folder, 'runner.plist'), plist?.content ?? '')
    expect(installedRunnerTokenOf('macos', { ...paths, launchAgentPath: join(state.folder, 'runner.plist') })).toBe(runnerToken)
  })
})

describe('launchAgentStartSteps', () => {
  it('checks the plist, stops both labels, then waits on the current one before loading it', () => {
    const steps = launchAgentStartSteps(501, '/Users/dev/Library/LaunchAgents/dev.dashi.runner.plist')
    expect(steps.lint).toEqual(['plutil', '-lint', '/Users/dev/Library/LaunchAgents/dev.dashi.runner.plist'])
    expect(steps.bootouts).toEqual([
      ['launchctl', 'bootout', 'gui/501/dev.agent-dashboard.runner'],
      ['launchctl', 'bootout', 'gui/501/dev.dashi.runner'],
    ])
    expect(steps.isLoaded).toEqual(['launchctl', 'print', 'gui/501/dev.dashi.runner'])
    expect(steps.bootstrap).toEqual(['launchctl', 'bootstrap', 'gui/501', '/Users/dev/Library/LaunchAgents/dev.dashi.runner.plist'])
  })
})

describe('runnerServiceFilesFor', () => {
  const paths = cliPathsFor('/home/dev', undefined)
  const input = { dashboardUrl, runnerToken, nodePath: '/opt/node/bin/node', searchPath: '/opt/node/bin:/usr/bin:/bin' }

  it('keeps the token out of the systemd unit, in its own env file', () => {
    const files = runnerServiceFilesFor('linux', paths, input)
    const unit = files.find((file) => file.path.endsWith('dashi-runner.service'))
    const environmentFile = files.find((file) => file.path === paths.runnerEnvPath)
    expect(unit?.content).not.toContain(runnerToken)
    expect(unit?.content).toContain(`EnvironmentFile=${paths.runnerEnvPath}`)
    expect(unit?.content).toContain('ExecStart=/opt/node/bin/node /home/dev/dashi/runner.ts')
    expect(environmentFile?.content).toBe(`DASHI_URL=${dashboardUrl}\nDASHI_RUNNER_TOKEN=${runnerToken}\n`)
  })

  it('writes one login agent on macOS with node, the script and the PATH it needs', () => {
    const [plist, ...others] = runnerServiceFilesFor('macos', paths, input)
    expect(others).toEqual([])
    expect(plist?.path).toBe('/home/dev/Library/LaunchAgents/dev.dashi.runner.plist')
    expect(plist?.content).toContain('<string>/opt/node/bin/node</string><string>/home/dev/dashi/runner.ts</string>')
    expect(plist?.content).toContain('<key>PATH</key><string>/opt/node/bin:/usr/bin:/bin</string>')
  })

  it('escapes what XML would read as markup', () => {
    const [plist] = runnerServiceFilesFor('macos', cliPathsFor('/Users/a&b', undefined), input)
    expect(plist?.content).toContain('/Users/a&amp;b/dashi/runner.ts')
  })
})

describe('cliPathsFor', () => {
  it('follows CLAUDE_CONFIG_DIR when it is set', () => {
    expect(cliPathsFor('/home/dev', undefined).claudeSettingsPath).toBe('/home/dev/.claude/settings.json')
    expect(cliPathsFor('/home/dev', '/srv/claude').claudeSettingsPath).toBe('/srv/claude/settings.json')
  })
})

describe('isSupportedNode', () => {
  it('needs 22.18 or later', () => {
    expect(isSupportedNode('22.18.0')).toBe(true)
    expect(isSupportedNode('24.1.0')).toBe(true)
    expect(isSupportedNode('22.17.1')).toBe(false)
    expect(isSupportedNode('20.19.0')).toBe(false)
  })
})

describe('doctorReport', () => {
  it('prints the fix under a failed check only', () => {
    expect(
      doctorReport([
        { name: 'git', passed: true, detail: '' },
        { name: 'Claude Code', passed: false, detail: 'install Claude Code' },
      ]),
    ).toBe('ok   git\nFAIL Claude Code\n     install Claude Code')
  })
})
