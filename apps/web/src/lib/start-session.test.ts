import { describe, expect, it } from 'vitest'
import type { StartOptions } from '@dashi/contracts'
import { runnerLaunchAgentCommands, runnerReviewCommands, runnerSystemdCommands, runnerTryCommands } from './runner-setup'
import { agentFor, choicesWithAgent, defaultTargetFor, openRouterModelFor, startModelProblemFor, suggestedWorkflowFor, targetAvailabilityFor } from './start-session'

const onlineRunner = { label: 'Mac mini', lastSeenAt: '2026-09-30T10:00:00Z', isOnline: true }
const optionsWith = (overrides: Partial<StartOptions>): StartOptions => ({
  runners: [],
  routineConfigured: false,
  attachmentLimits: { fileCount: 5, fileTargetBytes: 8 * 1024 * 1024, inlineTargetBytes: 48 * 1024 },
  ...overrides,
})

describe('suggestedWorkflowFor', () => {
  it('reads the workflow from the first label it knows', () => {
    expect(suggestedWorkflowFor([{ name: 'P1', color: '' }, { name: 'Bug', color: '' }])).toBe('fix')
    expect(suggestedWorkflowFor([{ name: 'documentation', color: '' }])).toBe('docs')
    expect(suggestedWorkflowFor([])).toBe('feature')
  })
})

describe('targetAvailabilityFor', () => {
  it('turns a session away when the attachments are larger than it takes', () => {
    const options = optionsWith({ runners: [onlineRunner], routineConfigured: true })
    expect(targetAvailabilityFor('laptop-remote-control', options, 100 * 1024)).toEqual({ isAvailable: true, hint: null })
    expect(targetAvailabilityFor('cloud-routine', options, 100 * 1024)).toEqual({
      isAvailable: false,
      hint: 'Takes at most 48 KB of attachments',
    })
    expect(targetAvailabilityFor('laptop-cloud', options, 100 * 1024).isAvailable).toBe(false)
  })

  it('needs a routine for the cloud routine', () => {
    expect(targetAvailabilityFor('cloud-routine', optionsWith({}), 0).isAvailable).toBe(false)
    expect(targetAvailabilityFor('cloud-routine', optionsWith({ routineConfigured: true }), 0)).toEqual({ isAvailable: true, hint: null })
  })

  it('queues for a runner that is set up but offline, and refuses when none is set up', () => {
    expect(targetAvailabilityFor('laptop-headless', optionsWith({}), 0)).toEqual({
      isAvailable: false,
      hint: 'Set up the laptop runner under Credentials',
    })
    expect(targetAvailabilityFor('laptop-headless', optionsWith({ runners: [{ ...onlineRunner, isOnline: false }] }), 0)).toEqual({
      isAvailable: true,
      hint: expect.stringContaining('waits'),
    })
    expect(targetAvailabilityFor('laptop-remote-control', optionsWith({ runners: [onlineRunner] }), 0)).toEqual({ isAvailable: true, hint: null })
  })
})

describe('defaultTargetFor', () => {
  it('prefers the laptop when its runner is online, then the routine', () => {
    expect(defaultTargetFor(optionsWith({ runners: [onlineRunner], routineConfigured: true }))).toBe('laptop-remote-control')
    expect(defaultTargetFor(optionsWith({ routineConfigured: true }))).toBe('cloud-routine')
  })
})

describe('agentFor', () => {
  it('runs OpenCode only on an unattended laptop start that picked it', () => {
    expect(agentFor({ agent: 'opencode' }, 'laptop-headless')).toBe('opencode')
    expect(agentFor({ agent: 'opencode' }, 'laptop-remote-control')).toBe('claude')
    expect(agentFor({ agent: 'opencode' }, 'cloud-routine')).toBe('claude')
    expect(agentFor({ agent: 'claude' }, 'laptop-headless')).toBe('claude')
  })
})

describe('choicesWithAgent', () => {
  it("keeps the permission mode when the new agent has it, and falls back to auto when it does not", () => {
    const choices = { workflow: 'fix' as const, target: null, agent: 'claude' as const, permissionMode: 'acceptEdits' as const, modelSource: 'default' as const, openRouterModel: '' }
    expect(choicesWithAgent(choices, 'opencode')).toMatchObject({ agent: 'opencode', permissionMode: 'auto' })
    expect(choicesWithAgent({ ...choices, permissionMode: 'dontAsk' }, 'opencode')).toMatchObject({ permissionMode: 'dontAsk' })
    expect(choicesWithAgent({ ...choices, agent: 'opencode', permissionMode: 'dontAsk' }, 'claude')).toMatchObject({ agent: 'claude', permissionMode: 'dontAsk' })
  })
})

describe('the model a start runs on', () => {
  const onOpenRouter = { modelSource: 'openrouter' as const, openRouterModel: ' meta-llama/llama-3.3-70b-instruct:free ' }

  it('sends an OpenRouter model only for an unattended laptop start that picked one', () => {
    expect(openRouterModelFor(onOpenRouter, 'laptop-headless')).toBe('meta-llama/llama-3.3-70b-instruct:free')
    expect(openRouterModelFor(onOpenRouter, 'laptop-remote-control')).toBeNull()
    expect(openRouterModelFor(onOpenRouter, 'cloud-routine')).toBeNull()
    expect(openRouterModelFor({ ...onOpenRouter, modelSource: 'default' }, 'laptop-headless')).toBeNull()
  })

  it('holds the start back until an OpenRouter model reads as a model slug', () => {
    expect(startModelProblemFor(onOpenRouter, 'laptop-headless')).toBeNull()
    expect(startModelProblemFor({ ...onOpenRouter, openRouterModel: '' }, 'laptop-headless')).toBe('Name the OpenRouter model to run on')
    expect(startModelProblemFor({ ...onOpenRouter, openRouterModel: 'gpt 5' }, 'laptop-headless')).toBe(
      'An OpenRouter model reads like provider/model, such as openai/gpt-5-mini',
    )
    expect(startModelProblemFor({ ...onOpenRouter, openRouterModel: '' }, 'laptop-remote-control')).toBeNull()
  })
})

describe('runner setup commands', () => {
  const sha256 = 'a'.repeat(64)
  const input = { dashboardUrl: 'https://dashi.example', runnerToken: 'adr_secret', scriptSha256: sha256, platform: 'macos' as const }

  it('checks the downloaded script against the hash before running it', () => {
    const commands = runnerTryCommands(input)
    expect(commands).toContain(`echo "${sha256}  $HOME/dashi/runner.ts" | shasum -a 256 -c -`)
    expect(commands.indexOf('shasum')).toBeLessThan(commands.indexOf('node ~/dashi/runner.ts'))
    expect(commands.split('\n').slice(0, 2)).toEqual(['(', 'set -e'])
  })

  it('checks with sha256sum on Linux, and opens the script to read before anything runs', () => {
    const commands = runnerReviewCommands({ ...input, platform: 'linux' })
    expect(commands).toContain('| sha256sum -c -')
    expect(commands).toContain('less ~/dashi/runner.ts')
    expect(commands).not.toContain('adr_secret')
  })

  it('installs a login agent readable by this user only', () => {
    const commands = runnerLaunchAgentCommands(input)
    expect(commands).toContain('<key>DASHI_RUNNER_TOKEN</key><string>adr_secret</string>')
    expect(commands).toContain('chmod 600 ~/Library/LaunchAgents/dev.dashi.runner.plist')
    expect(commands.indexOf('shasum')).toBeLessThan(commands.indexOf('launchctl bootstrap gui/$(id -u)'))
  })

  it('checks the plist, then waits for an older runner to stop before loading the new one', () => {
    const commands = runnerLaunchAgentCommands(input)
    const bootoutAt = commands.indexOf('launchctl bootout gui/$(id -u)/dev.dashi.runner')
    const waitAt = commands.indexOf('launchctl print gui/$(id -u)/dev.dashi.runner >/dev/null 2>&1 || break')
    const bootstrapAt = commands.indexOf('launchctl bootstrap gui/$(id -u)')
    expect(commands.indexOf('plutil -lint ~/Library/LaunchAgents/dev.dashi.runner.plist')).toBeLessThan(bootoutAt)
    expect(bootoutAt).toBeLessThan(waitAt)
    expect(waitAt).toBeLessThan(bootstrapAt)
  })

  it('removes the runner installed under the name from before Dashi, so only one polls', () => {
    const commands = runnerLaunchAgentCommands(input)
    expect(commands).toContain('launchctl bootout gui/$(id -u)/dev.agent-dashboard.runner 2>/dev/null || true')
    expect(commands).toContain('rm -f ~/Library/LaunchAgents/dev.agent-dashboard.runner.plist')
    expect(commands.indexOf('dev.agent-dashboard.runner')).toBeLessThan(commands.indexOf('launchctl bootstrap'))
  })

  it('installs a systemd user service with the token only in a file of its own', () => {
    const commands = runnerSystemdCommands({ ...input, platform: 'linux' })
    const unit = commands.slice(commands.indexOf('[Unit]'), commands.indexOf('WantedBy=default.target'))
    expect(unit).toContain('EnvironmentFile=%h/dashi/runner.env')
    expect(unit).not.toContain('adr_secret')
    expect(commands).toContain('DASHI_RUNNER_TOKEN=adr_secret')
    expect(commands).toContain('chmod 600 ~/dashi/runner.env')
    expect(commands.indexOf('sha256sum')).toBeLessThan(commands.indexOf('systemctl --user enable --now dashi-runner'))
  })
})
