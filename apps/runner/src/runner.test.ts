import { describe, expect, it } from 'vitest'
import {
  chatDeliveryPlanFor,
  cloudSendArgumentsFor,
  cloudSendOutcomeOf,
  cloudSessionUrlFrom,
  deliveryPlanFor,
  isStartProjectFolder,
  launchPlanFor,
  modelEnvironmentFor,
  newestTranscriptOf,
  parseChatWork,
  parseClaim,
  parseTmuxPanes,
  readRunnerSettings,
  resumeArgumentsFor,
  sessionEnvironmentFor,
  runnerPathsFor,
  summariseTranscript,
  tmuxSessionNameFor,
  withAttachmentPaths,
} from './runner.ts'

const startId = '0123abcd-0000-4000-8000-000000000000'
const claimBody = (overrides: Record<string, unknown> = {}) => ({
  start: {
    startId,
    repository: { owner: 'cnotv', name: 'generative-art' },
    target: 'laptop-remote-control',
    permissionMode: 'auto',
    ...overrides,
  },
  prompt: '/workflow:start fix https://github.com/cnotv/generative-art/issues/42\n\nKeep it small; $(rm -rf ~) stays text',
  sessionName: 'generative-art #42 fix',
})

const claimOf = (overrides: Record<string, unknown> = {}) => {
  const claimed = parseClaim(claimBody(overrides))
  if (claimed === null) throw new Error('The test claim did not parse')
  return claimed
}

describe('parseClaim', () => {
  it('accepts a claim the dashboard can send', () => {
    expect(claimOf().start.repository).toEqual({ owner: 'cnotv', name: 'generative-art' })
  })

  it('refuses repositories that could escape the runner folder, and unknown targets or modes', () => {
    expect(parseClaim(claimBody({ repository: { owner: 'cnotv', name: '..' } }))).toBeNull()
    expect(parseClaim(claimBody({ repository: { owner: '../etc', name: 'x' } }))).toBeNull()
    expect(parseClaim(claimBody({ target: 'cloud-routine' }))).toBeNull()
    expect(parseClaim(claimBody({ permissionMode: 'bypassPermissions' }))).toBeNull()
    expect(parseClaim(claimBody({ startId: '../../x' }))).toBeNull()
    expect(parseClaim({ start: null })).toBeNull()
  })

  it('reads the agent, Claude Code unless the dashboard says OpenCode, and OpenCode only unattended', () => {
    expect(claimOf().start.agent).toBe('claude')
    expect(claimOf({ target: 'laptop-headless', agent: 'opencode' }).start.agent).toBe('opencode')
    expect(parseClaim(claimBody({ agent: 'opencode' }))).toBeNull()
    expect(parseClaim(claimBody({ target: 'laptop-headless', agent: 'codex' }))).toBeNull()
  })

  it('reads an OpenRouter model only for an unattended start, and only as a model slug', () => {
    const headless = { target: 'laptop-headless' }
    expect(claimOf().start.openRouterModel).toBeNull()
    expect(claimOf({ ...headless, openRouterModel: 'openai/gpt-5-mini' }).start.openRouterModel).toBe('openai/gpt-5-mini')
    expect(parseClaim(claimBody({ openRouterModel: 'openai/gpt-5-mini' }))).toBeNull()
    expect(parseClaim(claimBody({ ...headless, openRouterModel: '--dangerously-skip-permissions' }))).toBeNull()
    expect(parseClaim(claimBody({ ...headless, openRouterModel: 'a/b\nANTHROPIC_BASE_URL=https://evil' }))).toBeNull()
  })
})

describe('attachments', () => {
  const screenshot = { name: 'ramp.png', mediaType: 'image/png', base64: 'aGVsbG8=' }

  it('reads attachments from a claim and refuses names that could leave their folder', () => {
    expect(parseClaim({ ...claimBody(), attachments: [screenshot] })?.attachments).toEqual([screenshot])
    expect(parseClaim(claimBody())?.attachments).toEqual([])
    expect(parseClaim({ ...claimBody(), attachments: [{ ...screenshot, name: '../../.zshrc' }] })).toBeNull()
    expect(parseClaim({ ...claimBody(), attachments: [{ ...screenshot, base64: 'not base64!' }] })).toBeNull()
    expect(parseClaim({ ...claimBody(), attachments: 'ramp.png' })).toBeNull()
  })

  it('names the saved attachments in the prompt, beside the worktree', () => {
    const claimed = parseClaim({ ...claimBody(), attachments: [screenshot] })
    if (claimed === null) throw new Error('The test claim did not parse')
    const paths = runnerPathsFor('/Users/me/dashi', claimed)
    expect(paths.attachmentsPath).toBe('/Users/me/dashi/attachments/generative-art-0123abcd')
    expect(withAttachmentPaths(claimed, paths).prompt).toBe(
      `${claimed.prompt}\n\nAttachments, saved on this laptop; read each with the Read tool:\n\n- /Users/me/dashi/attachments/generative-art-0123abcd/ramp.png`,
    )
    expect(withAttachmentPaths(claimOf(), paths).prompt).toBe(claimOf().prompt)
  })
})

describe('launchPlanFor', () => {
  const paths = runnerPathsFor('/Users/me/dashi', claimOf())

  it('starts a steerable session in tmux, passing the prompt as one argument', () => {
    const plan = launchPlanFor(claimOf(), paths, {})
    expect(plan.mode).toBe('tmux')
    expect(plan.args).toEqual([
      'new-session',
      '-d',
      '-s',
      'agent-generative-art-0123abcd',
      '-c',
      '/Users/me/dashi/worktrees/generative-art-0123abcd',
      '-e',
      `DASHI_START_ID=${claimOf().start.startId}`,
      'claude',
      '--remote-control',
      '--name',
      'generative-art #42 fix',
      claimOf().prompt,
    ])
  })

  it('runs an unattended session with the chosen permission mode', () => {
    const plan = launchPlanFor(claimOf({ target: 'laptop-headless', permissionMode: 'acceptEdits' }), paths, {})
    expect(plan).toMatchObject({ mode: 'detached', command: 'claude', cwd: paths.worktreePath, environment: { DASHI_START_ID: claimOf().start.startId } })
    expect(plan.args).toEqual(['-p', claimOf().prompt, '--permission-mode', 'acceptEdits', '--output-format', 'json'])
  })

  it('runs an unattended session on an OpenRouter model with the laptop key in its environment only', () => {
    const openRouterKey = 'sk-or-v1-exampleKey0123456789'
    const plan = launchPlanFor(claimOf({ target: 'laptop-headless', openRouterModel: 'openai/gpt-5-mini' }), paths, { OPENROUTER_API_KEY: openRouterKey })
    expect(plan.environment).toEqual({
      DASHI_START_ID: claimOf().start.startId,
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      ANTHROPIC_AUTH_TOKEN: openRouterKey,
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: 'openai/gpt-5-mini',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'openai/gpt-5-mini',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'openai/gpt-5-mini',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'openai/gpt-5-mini',
    })
    expect(plan.args.join(' ')).not.toContain(openRouterKey)
  })

  it('keeps the OpenRouter key out of every session but as the auth token of one on OpenRouter', () => {
    const openRouterKey = 'sk-or-v1-exampleKey0123456789'
    const runnerEnvironment = { PATH: '/usr/bin', OPENROUTER_API_KEY: openRouterKey }
    expect(sessionEnvironmentFor(runnerEnvironment, { DASHI_START_ID: startId })).toEqual({ PATH: '/usr/bin', DASHI_START_ID: startId })
    const onOpenRouter = sessionEnvironmentFor(runnerEnvironment, modelEnvironmentFor('openai/gpt-5-mini', runnerEnvironment))
    expect(onOpenRouter.OPENROUTER_API_KEY).toBeUndefined()
    expect(onOpenRouter.ANTHROPIC_AUTH_TOKEN).toBe(openRouterKey)
  })

  it('refuses an OpenRouter start when the laptop has no OpenRouter key', () => {
    expect(() => launchPlanFor(claimOf({ target: 'laptop-headless', openRouterModel: 'openai/gpt-5-mini' }), paths, {})).toThrow(
      'OPENROUTER_API_KEY',
    )
  })

  it('runs an unattended OpenCode start with opencode run, auto-approving only in auto mode', () => {
    const plan = launchPlanFor(claimOf({ target: 'laptop-headless', agent: 'opencode' }), paths, {})
    expect(plan).toMatchObject({ mode: 'detached', command: 'opencode', cwd: paths.worktreePath, environment: { DASHI_START_ID: startId } })
    expect(plan.args).toEqual(['run', '--title=generative-art #42 fix', '--auto', claimOf().prompt])
    const asked = launchPlanFor(claimOf({ target: 'laptop-headless', agent: 'opencode', permissionMode: 'dontAsk' }), paths, {})
    expect(asked.args).toEqual(['run', '--title=generative-art #42 fix', claimOf().prompt])
    const dashedName = launchPlanFor(claimOf({ target: 'laptop-headless', agent: 'opencode', repository: { owner: 'cnotv', name: '--auto' } }), paths, {})
    expect(dashedName.args.filter((argument) => argument === '--auto')).toEqual(['--auto'])
  })

  it("runs OpenCode on an OpenRouter model with the laptop's key under OpenCode's own name for it", () => {
    const openRouterKey = 'sk-or-v1-exampleKey0123456789'
    const plan = launchPlanFor(
      claimOf({ target: 'laptop-headless', agent: 'opencode', openRouterModel: 'openai/gpt-5-mini' }),
      paths,
      { OPENROUTER_API_KEY: openRouterKey },
    )
    expect(plan.args.slice(0, 2)).toEqual(['run', '--model=openrouter/openai/gpt-5-mini'])
    expect(plan.environment).toEqual({ DASHI_START_ID: startId, OPENROUTER_API_KEY: openRouterKey })
    expect(() => launchPlanFor(claimOf({ target: 'laptop-headless', agent: 'opencode', openRouterModel: 'openai/gpt-5-mini' }), paths, {})).toThrow(
      'OPENROUTER_API_KEY',
    )
  })

  it('sends a cloud session from the clone itself', () => {
    expect(launchPlanFor(claimOf({ target: 'laptop-cloud' }), paths, {})).toEqual({
      mode: 'capture',
      command: 'claude',
      args: ['--cloud', claimOf().prompt],
      cwd: '/Users/me/dashi/repos/cnotv/generative-art',
      environment: { DASHI_START_ID: claimOf().start.startId },
    })
  })
})

describe('tmuxSessionNameFor', () => {
  it('replaces the dots tmux refuses', () => {
    expect(tmuxSessionNameFor(claimOf({ repository: { owner: 'cnotv', name: 'site.io' } }))).toBe('agent-site-io-0123abcd')
  })
})

describe('cloudSessionUrlFrom', () => {
  it('finds the session link in what claude --cloud printed', () => {
    expect(cloudSessionUrlFrom('Created cloud session\nhttps://claude.ai/code/session_01AbC-x_9 (open it)')).toBe(
      'https://claude.ai/code/session_01AbC-x_9',
    )
    expect(cloudSessionUrlFrom('error: not logged in')).toBeNull()
  })
})

describe('readRunnerSettings', () => {
  it('needs an https dashboard, or one on this machine, and a runner token', () => {
    expect(readRunnerSettings({ DASHI_URL: 'http://dashi.example', DASHI_RUNNER_TOKEN: 'adr_x' })).toEqual(expect.stringContaining('https://'))
    expect(readRunnerSettings({ DASHI_URL: 'https://dashi.example/', DASHI_RUNNER_TOKEN: 'adt_x' })).toEqual(
      expect.stringContaining('runner token'),
    )
    expect(
      readRunnerSettings({
        DASHI_URL: 'https://dashi.example/',
        DASHI_RUNNER_TOKEN: 'adr_x',
        DASHI_RUNNER_HOME: '/tmp/r',
        CLAUDE_CONFIG_DIR: '/tmp/claude',
      }),
    ).toEqual({ dashboardUrl: 'https://dashi.example', runnerToken: 'adr_x', runnerHome: '/tmp/r', claudeHome: '/tmp/claude', pollMilliseconds: 5000 })
  })

  it('still reads a runner installed under the names from before Dashi, the new names winning', () => {
    const settings = readRunnerSettings({
      AGENT_DASHBOARD_URL: 'https://old.example',
      AGENT_DASHBOARD_RUNNER_TOKEN: 'adr_old',
      AGENT_DASHBOARD_RUNNER_HOME: '/tmp/old',
      DASHI_URL: 'https://dashi.example',
      DASHI_RUNNER_HOME: '',
    })
    expect(settings).toMatchObject({ dashboardUrl: 'https://dashi.example', runnerToken: 'adr_old', runnerHome: '/tmp/old' })
  })
})

const sessionId = '0f6f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b'
const deliveryId = '1a2b3c4d-0000-4000-8000-000000000000'

describe('parseChatWork', () => {
  it('keeps sessions and deliveries whose ids are safe, and drops the rest', () => {
    const work = parseChatWork({
      sessions: [
        { sessionId, sessionState: 'working' },
        { sessionId: '../../etc/passwd', sessionState: 'working' },
        { sessionId, sessionState: 'mystery' },
      ],
      deliveries: [
        { deliveryId, sessionId, text: 'Also the docs', sessionState: null },
        { deliveryId: 'x; rm -rf', sessionId, text: 'no', sessionState: null },
      ],
    })
    expect(work).toEqual({
      sessions: [{ sessionId, sessionState: 'working', start: null, cloudSessionId: null, openRouterModel: null }],
      deliveries: [{ deliveryId, sessionId, text: 'Also the docs', sessionState: null, start: null, cloudSessionId: null, openRouterModel: null }],
    })
    expect(parseChatWork(null)).toEqual({ sessions: [], deliveries: [] })
  })

  it("keeps a board start's repository, id and target, and drops one that could escape the runner folder", () => {
    const start = { repositoryName: 'generative-art', startId, target: 'laptop-headless' }
    const startChatId = `start-${startId}`
    expect(parseChatWork({ sessions: [{ sessionId: startChatId, sessionState: null, start }], deliveries: [] }).sessions).toEqual([
      { sessionId: startChatId, sessionState: null, start, cloudSessionId: null, openRouterModel: null },
    ])
    const escaping = { sessionId: startChatId, sessionState: null, start: { ...start, repositoryName: '..' } }
    const cloud = { sessionId: startChatId, sessionState: null, start: { ...start, target: 'laptop-cloud' } }
    expect(parseChatWork({ sessions: [escaping, cloud], deliveries: [] }).sessions).toEqual([])
  })

  it('keeps the OpenRouter model a session resumes on, and drops one that is not a model slug', () => {
    const onModel = { sessionId, sessionState: 'ended', openRouterModel: 'openai/gpt-5-mini' }
    expect(parseChatWork({ sessions: [onModel], deliveries: [] }).sessions).toEqual([{ ...onModel, start: null, cloudSessionId: null }])
    expect(parseChatWork({ sessions: [{ ...onModel, openRouterModel: '-p x' }], deliveries: [] }).sessions).toEqual([])
  })

  it('keeps the cloud session a message goes to, and drops one that is not a cloud session id', () => {
    const cloudSessionId = 'session_01AbCdEfGh'
    const delivery = { deliveryId, sessionId: cloudSessionId, text: 'Also the docs', sessionState: null, start: null }
    expect(parseChatWork({ sessions: [], deliveries: [{ ...delivery, cloudSessionId }] }).deliveries).toEqual([{ ...delivery, cloudSessionId, openRouterModel: null }])
    expect(parseChatWork({ sessions: [], deliveries: [{ ...delivery, cloudSessionId: '--help' }] }).deliveries).toEqual([])
  })
})

describe('sending to a cloud session', () => {
  it('names the session as an argument and leaves the message for standard input', () => {
    expect(cloudSendArgumentsFor('session_01AbCdEfGh')).toEqual(['-p', '--cloud', 'session_01AbCdEfGh', '--output-format', 'json'])
  })

  it('reads whether claude --cloud queued the message', () => {
    expect(cloudSendOutcomeOf('{"ok":true,"session_id":"session_01AbCdEfGh","url":"https://claude.ai/code/session_01AbCdEfGh"}\n', '')).toEqual({
      state: 'delivered',
      message: null,
    })
    expect(cloudSendOutcomeOf('{"ok":false,"session_id":"session_01AbCdEfGh","error":"cloud session is archived"}', '')).toEqual({
      state: 'failed',
      message: 'cloud session is archived',
    })
    expect(cloudSendOutcomeOf('', 'Error: Cloud sessions are disabled by your organization\'s policy.')).toEqual({
      state: 'failed',
      message: "Error: Cloud sessions are disabled by your organization's policy.",
    })
    expect(cloudSendOutcomeOf('', '')).toEqual({ state: 'failed', message: 'claude --cloud gave no answer' })
  })
})

describe('finding a board start\'s transcript', () => {
  const start = { repositoryName: 'generative.art', startId, target: 'laptop-remote-control' as const }

  it("matches the project folder Claude Code names after the start's worktree", () => {
    expect(isStartProjectFolder('-Users-me-dashi-worktrees-generative-art-0123abcd', start)).toBe(true)
    expect(isStartProjectFolder('-Users-me-dashi-worktrees-generative-art-99999999', start)).toBe(false)
    expect(isStartProjectFolder('-Users-me-code-generative-art', start)).toBe(false)
  })

  it('takes the transcript written to last, ignoring other files', () => {
    expect(
      newestTranscriptOf([
        { name: 'a.jsonl', modifiedAt: 10 },
        { name: 'b.jsonl', modifiedAt: 30 },
        { name: 'notes.txt', modifiedAt: 99 },
      ]),
    ).toEqual({ name: 'b.jsonl', modifiedAt: 30 })
    expect(newestTranscriptOf([])).toBeNull()
  })
})

describe('chatDeliveryPlanFor', () => {
  const directory = '/Users/me/dashi/worktrees/generative-art-0123abcd'
  const headlessStart = {
    sessionId: `start-${startId}`,
    sessionState: null,
    start: { repositoryName: 'generative-art', startId, target: 'laptop-headless' as const },
    cloudSessionId: null,
    openRouterModel: null,
  }

  it('waits for an unattended start to go quiet, then resumes it', () => {
    expect(chatDeliveryPlanFor(headlessStart, [], directory, 5_000)).toMatchObject({ route: 'none', reason: expect.stringContaining('still running') })
    expect(chatDeliveryPlanFor(headlessStart, [], directory, 120_000)).toEqual({ route: 'resume', directory })
  })

  it('types into the tmux pane of a steerable start', () => {
    const steerableStart = { ...headlessStart, start: { ...headlessStart.start, target: 'laptop-remote-control' as const } }
    expect(chatDeliveryPlanFor(steerableStart, parseTmuxPanes(`%9 claude ${directory}`), directory, 1_000)).toEqual({ route: 'tmux', paneId: '%9' })
  })
})

describe('summariseTranscript', () => {
  const line = (entry: Record<string, unknown>) => JSON.stringify(entry)
  const transcript = [
    line({ type: 'summary', summary: 'x' }),
    line({
      type: 'user',
      uuid: 'u1',
      cwd: '/Users/me/dashi/worktrees/x',
      timestamp: '2026-09-30T10:00:00Z',
      message: { role: 'user', content: '<command-message>workflow:start</command-message>\n<command-name>/workflow:start</command-name>\n<command-args>fix https://github.com/x/y/issues/1</command-args>' },
    }),
    line({ type: 'user', uuid: 'u0', isMeta: true, message: { role: 'user', content: 'Caveat: meta' } }),
    line({
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-09-30T10:00:05Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hidden' },
          { type: 'text', text: 'Reading the issue.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'gh issue view 1\n  --comments' } },
        ],
      },
    }),
    line({ type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', content: 'secret output' }] } }),
    line({ type: 'assistant', uuid: 'a2', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'subagent' }] } }),
    'not json',
  ].join('\n')

  it('keeps typed messages, answers and tool uses, and leaves out results, thinking and side conversations', () => {
    const summary = summariseTranscript(transcript)
    expect(summary.directory).toBe('/Users/me/dashi/worktrees/x')
    expect(summary.messages.map(({ role, kind, text, toolName }) => ({ role, kind, text, toolName }))).toEqual([
      { role: 'user', kind: 'text', text: '/workflow:start fix https://github.com/x/y/issues/1', toolName: null },
      { role: 'assistant', kind: 'text', text: 'Reading the issue.', toolName: null },
      { role: 'assistant', kind: 'tool', text: 'gh issue view 1 --comments', toolName: 'Bash' },
    ])
    expect(JSON.stringify(summary)).not.toContain('secret output')
  })

  it('keeps only the most recent messages, each clipped', () => {
    const longTranscript = Array.from({ length: 200 }, (_, index) =>
      line({ type: 'assistant', uuid: `a${index}`, message: { role: 'assistant', content: [{ type: 'text', text: 'y'.repeat(5000) }] } }),
    ).join('\n')
    const { messages } = summariseTranscript(longTranscript)
    expect(messages).toHaveLength(150)
    expect(messages[0]?.messageId).toBe('a50-0')
    expect(messages[0]?.text.length).toBe(4001)
  })
})

describe('deliveryPlanFor', () => {
  const directory = '/Users/me/dashi/worktrees/x'
  const panes = parseTmuxPanes(`%1 zsh ${directory}\n%2 claude ${directory}\n%3 claude /elsewhere\nbroken line`)

  it('reads a folder with spaces from the end of the line', () => {
    expect(parseTmuxPanes('%7 node /Users/me/My Projects/x')).toEqual([{ paneId: '%7', command: 'node', directory: '/Users/me/My Projects/x' }])
  })

  it('types into the pane running Claude in the session folder, never a shell there', () => {
    expect(deliveryPlanFor('working', panes, directory)).toEqual({ route: 'tmux', paneId: '%2' })
    expect(deliveryPlanFor('idle', panes.filter((pane) => pane.paneId !== '%2'), directory)).toMatchObject({ route: 'none' })
    const withDevServer = parseTmuxPanes(`%4 node ${directory}\n%5 claude ${directory}`)
    expect(deliveryPlanFor('working', withDevServer, directory)).toEqual({ route: 'tmux', paneId: '%5' })
    expect(deliveryPlanFor('working', withDevServer.slice(0, 1), directory)).toEqual({ route: 'tmux', paneId: '%4' })
  })

  it('resumes an ended session and leaves one waiting on a permission alone', () => {
    expect(deliveryPlanFor('ended', [], directory)).toEqual({ route: 'resume', directory })
    expect(deliveryPlanFor('waiting', panes, directory)).toMatchObject({ route: 'none', reason: expect.stringContaining('permission') })
    expect(deliveryPlanFor('working', panes, null)).toMatchObject({ route: 'none' })
  })

  it('resumes an OpenRouter start on its model, and any other session on the Claude login', () => {
    const openRouterKey = 'sk-or-v1-exampleKey0123456789'
    expect(modelEnvironmentFor(null, { OPENROUTER_API_KEY: openRouterKey })).toEqual({})
    expect(modelEnvironmentFor('openai/gpt-5-mini', { OPENROUTER_API_KEY: openRouterKey })).toMatchObject({
      ANTHROPIC_AUTH_TOKEN: openRouterKey,
      ANTHROPIC_MODEL: 'openai/gpt-5-mini',
    })
  })

  it('passes the message to a resumed session as one argument', () => {
    expect(resumeArgumentsFor(sessionId, 'a; $(rm -rf ~)')).toEqual([
      '--resume',
      sessionId,
      '-p',
      'a; $(rm -rf ~)',
      '--permission-mode',
      'auto',
      '--output-format',
      'json',
    ])
  })
})
