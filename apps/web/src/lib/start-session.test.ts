import { describe, expect, it } from 'vitest'
import type { StartOptions, StartTarget, TicketAgent } from '@dashi/contracts'
import { runnerLaunchAgentCommands, runnerReviewCommands, runnerSystemdCommands, runnerTryCommands } from './runner-setup'
import {
  agentFor,
  choicesFromTicketAgent,
  choicesWithAgent,
  claudeModelFor,
  defaultTargetFor,
  modelSourcesFor,
  opencodeModelFor,
  openRouterModelFor,
  startModelProblemFor,
  targetAvailabilityFor,
  ticketAgentAfterAgentChange,
  ticketAgentOf,
} from './start-session'

const onlineRunner = { label: 'Mac mini', lastSeenAt: '2026-09-30T10:00:00Z', isOnline: true }
const optionsWith = (overrides: Partial<StartOptions>): StartOptions => ({
  runners: [],
  routineConfigured: false,
  attachmentLimits: { fileCount: 5, fileTargetBytes: 8 * 1024 * 1024, inlineTargetBytes: 48 * 1024 },
  ...overrides,
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
    const choices = { target: null, agent: 'claude' as const, permissionMode: 'acceptEdits' as const, modelSource: 'default' as const, openRouterModel: '', opencodeModel: '', claudeModel: '' }
    expect(choicesWithAgent(choices, 'opencode')).toMatchObject({ agent: 'opencode', permissionMode: 'auto' })
    expect(choicesWithAgent({ ...choices, permissionMode: 'dontAsk' }, 'opencode')).toMatchObject({ permissionMode: 'dontAsk' })
    expect(choicesWithAgent({ ...choices, agent: 'opencode', permissionMode: 'dontAsk' }, 'claude')).toMatchObject({ agent: 'claude', permissionMode: 'dontAsk' })
  })

  it('keeps the model source when the new agent offers it, and falls back to the default when it does not', () => {
    const choices = { target: null, agent: 'opencode' as const, permissionMode: 'auto' as const, modelSource: 'opencode' as const, openRouterModel: '', opencodeModel: 'opencode/big-pickle', claudeModel: '' }
    expect(choicesWithAgent(choices, 'claude')).toMatchObject({ agent: 'claude', modelSource: 'default' })
    expect(choicesWithAgent({ ...choices, modelSource: 'openrouter' }, 'claude')).toMatchObject({ modelSource: 'openrouter' })
  })
})

describe('the model a start runs on', () => {
  const onOpenRouter = { agent: 'claude' as const, modelSource: 'openrouter' as const, openRouterModel: 'meta-llama/llama-3.3-70b-instruct:free', opencodeModel: '', claudeModel: '' }
  const onOpenCodeModel = { agent: 'opencode' as const, modelSource: 'opencode' as const, openRouterModel: '', opencodeModel: 'opencode/longcat-2.5-preview-free', claudeModel: '' }

  it('sends an OpenRouter model only for an unattended laptop start that picked one', () => {
    expect(openRouterModelFor(onOpenRouter, 'laptop-headless')).toBe('meta-llama/llama-3.3-70b-instruct:free')
    expect(openRouterModelFor(onOpenRouter, 'laptop-remote-control')).toBeNull()
    expect(openRouterModelFor(onOpenRouter, 'cloud-routine')).toBeNull()
    expect(openRouterModelFor({ ...onOpenRouter, modelSource: 'default' }, 'laptop-headless')).toBeNull()
  })

  it('sends an OpenCode model only for an unattended OpenCode start that picked one', () => {
    expect(opencodeModelFor({ ...onOpenCodeModel, agent: 'claude' }, 'laptop-headless')).toBeNull()
    expect(opencodeModelFor(onOpenCodeModel, 'laptop-headless')).toBe('opencode/longcat-2.5-preview-free')
    expect(opencodeModelFor(onOpenCodeModel, 'laptop-remote-control')).toBeNull()
    expect(opencodeModelFor(onOpenCodeModel, 'cloud-routine')).toBeNull()
    expect(opencodeModelFor({ ...onOpenCodeModel, modelSource: 'default' }, 'laptop-headless')).toBeNull()
  })

  it('sends a Claude model for a Claude Code start on any laptop target that picked one, never for a routine', () => {
    const onClaudeModel = { agent: 'claude' as const, modelSource: 'claude' as const, openRouterModel: '', opencodeModel: '', claudeModel: 'sonnet' }
    expect(['laptop-headless', 'laptop-remote-control', 'laptop-cloud'].map((target) => claudeModelFor(onClaudeModel, target as StartTarget))).toEqual([
      'sonnet',
      'sonnet',
      'sonnet',
    ])
    expect(claudeModelFor(onClaudeModel, 'cloud-routine')).toBeNull()
    expect(claudeModelFor({ ...onClaudeModel, modelSource: 'default' }, 'laptop-headless')).toBeNull()
    expect(claudeModelFor({ ...onClaudeModel, agent: 'opencode' }, 'laptop-headless')).toBeNull()
  })

  it('offers the Claude model beside the login default on every laptop target, and nothing for a routine', () => {
    expect(modelSourcesFor('claude', 'laptop-headless')).toEqual(['default', 'claude', 'openrouter'])
    expect(modelSourcesFor('claude', 'laptop-remote-control')).toEqual(['default', 'claude'])
    expect(modelSourcesFor('claude', 'laptop-cloud')).toEqual(['default', 'claude'])
    expect(modelSourcesFor('claude', 'cloud-routine')).toEqual([])
    expect(modelSourcesFor('opencode', 'laptop-headless')).toEqual(['default', 'openrouter', 'opencode'])
  })

  it('holds the start back until a Claude model reads as an alias or a claude id', () => {
    const onClaudeModel = { agent: 'claude' as const, modelSource: 'claude' as const, openRouterModel: '', opencodeModel: '', claudeModel: 'opus' }
    expect(startModelProblemFor(onClaudeModel, 'laptop-remote-control')).toBeNull()
    expect(startModelProblemFor({ ...onClaudeModel, claudeModel: '' }, 'laptop-remote-control')).toBe('Pick a Claude model to run on')
    expect(startModelProblemFor({ ...onClaudeModel, claudeModel: 'gpt-5' }, 'laptop-headless')).toBe(
      'A Claude model is an alias such as opus, sonnet or haiku, or a full id such as claude-sonnet-4-5',
    )
    expect(startModelProblemFor({ ...onClaudeModel, claudeModel: '' }, 'cloud-routine')).toBeNull()
  })

  it('holds the start back until an OpenRouter model reads as a model slug', () => {
    expect(startModelProblemFor(onOpenRouter, 'laptop-headless')).toBeNull()
    expect(startModelProblemFor({ ...onOpenRouter, openRouterModel: '' }, 'laptop-headless')).toBe('Pick an OpenRouter model to run on')
    expect(startModelProblemFor({ ...onOpenRouter, openRouterModel: 'gpt 5' }, 'laptop-headless')).toBe(
      'An OpenRouter model reads like provider/model, such as openai/gpt-5-mini',
    )
    expect(startModelProblemFor({ ...onOpenRouter, openRouterModel: '' }, 'laptop-remote-control')).toBeNull()
  })

  it('holds the start back until an OpenCode model reads as a model slug', () => {
    expect(startModelProblemFor(onOpenCodeModel, 'laptop-headless')).toBeNull()
    expect(startModelProblemFor({ ...onOpenCodeModel, opencodeModel: '' }, 'laptop-headless')).toBe('Pick an OpenCode model to run on')
    expect(startModelProblemFor({ ...onOpenCodeModel, opencodeModel: 'not-a-model' }, 'laptop-headless')).toBe(
      'An OpenCode model reads like opencode/model, such as opencode/longcat-2.5-preview-free',
    )
    expect(startModelProblemFor({ ...onOpenCodeModel, opencodeModel: '' }, 'laptop-remote-control')).toBeNull()
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

const dialogDefaults = {
  target: null,
  agent: 'claude',
  permissionMode: 'auto',
  modelSource: 'default',
  openRouterModel: '',
  opencodeModel: '',
  claudeModel: '',
} as const

describe('choicesFromTicketAgent', () => {
  it('opens the dialog on the agent, target and model of the ticket', () => {
    const choice: TicketAgent = { agent: 'opencode', target: 'laptop-headless', model: 'opencode/big-pickle' }
    const choices = choicesFromTicketAgent(choice)
    expect(choices).toMatchObject({ target: 'laptop-headless', agent: 'opencode', modelSource: 'opencode', opencodeModel: 'opencode/big-pickle' })
    expect(openRouterModelFor(choices, 'laptop-headless')).toBeNull()
    expect(opencodeModelFor(choices, 'laptop-headless')).toBe('opencode/big-pickle')
    expect(agentFor(choices, 'laptop-headless')).toBe('opencode')
  })

  it('selects OpenRouter for a provider slug', () => {
    const choices = choicesFromTicketAgent({ agent: 'claude', target: 'laptop-headless', model: 'anthropic/claude-sonnet-4.5' })
    expect(choices).toMatchObject({ agent: 'claude', modelSource: 'openrouter', openRouterModel: 'anthropic/claude-sonnet-4.5' })
    expect(openRouterModelFor(choices, 'laptop-headless')).toBe('anthropic/claude-sonnet-4.5')
  })

  it('selects the Claude model source for a Claude model', () => {
    const choices = choicesFromTicketAgent({ agent: 'claude', target: 'laptop-headless', model: 'sonnet' })
    expect(choices).toMatchObject({ agent: 'claude', modelSource: 'claude', claudeModel: 'sonnet' })
    expect(claudeModelFor(choices, 'laptop-headless')).toBe('sonnet')
    expect(openRouterModelFor(choices, 'laptop-headless')).toBeNull()
  })

  it('leaves the dialog on its own defaults without a line', () => {
    expect(choicesFromTicketAgent(null)).toEqual(dialogDefaults)
  })
})

describe('ticketAgentAfterAgentChange', () => {
  it('switches the agent and keeps the target and a model the new agent can run', () => {
    expect(
      ticketAgentAfterAgentChange({ state: 'set', choice: { agent: 'claude', target: 'laptop-headless', model: 'anthropic/claude-sonnet-4.5' } }, 'opencode'),
    ).toEqual({ agent: 'opencode', target: 'laptop-headless', model: 'anthropic/claude-sonnet-4.5' })
  })

  it('drops a Claude model that OpenCode cannot run, and moves OpenCode to a place it runs', () => {
    expect(ticketAgentAfterAgentChange({ state: 'set', choice: { agent: 'claude', target: 'cloud-routine', model: 'sonnet' } }, 'opencode')).toEqual({
      agent: 'opencode',
      target: 'laptop-headless',
      model: null,
    })
  })

  it('starts from the unattended laptop when the ticket had no usable line', () => {
    expect(ticketAgentAfterAgentChange({ state: 'missing' }, 'claude')).toEqual({ agent: 'claude', target: 'laptop-headless', model: null })
    expect(ticketAgentAfterAgentChange({ state: 'invalid', text: 'Agent: x', problem: 'p' }, 'opencode')).toEqual({
      agent: 'opencode',
      target: 'laptop-headless',
      model: null,
    })
  })
})

describe('a proposed agent', () => {
  const proposed = { state: 'proposed', choice: { agent: 'opencode', target: 'laptop-headless', model: 'opencode/big-pickle' }, reason: 'A small chore' } as const

  it('opens the Start dialog like an explicit line does, so it can still be changed', () => {
    expect(ticketAgentOf(proposed)).toEqual(proposed.choice)
    expect(choicesFromTicketAgent(ticketAgentOf(proposed))).toMatchObject({ agent: 'opencode', target: 'laptop-headless', opencodeModel: 'opencode/big-pickle' })
  })

  it('keeps its target and model when the owner changes the agent, which writes the line', () => {
    expect(ticketAgentAfterAgentChange(proposed, 'opencode')).toEqual(proposed.choice)
  })
})
