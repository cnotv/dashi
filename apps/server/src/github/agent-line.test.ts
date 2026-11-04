import { describe, expect, it } from 'vitest'
import { bodyWithAgentLine, parseAgentLine } from './agent-line.ts'

describe('parseAgentLine', () => {
  it('reads the agent, target and model of the line', () => {
    expect(parseAgentLine('## What\n\nDo it.\n\nAgent: claude laptop-headless sonnet\n\n## Done')).toEqual({
      state: 'set',
      choice: { agent: 'claude', target: 'laptop-headless', model: 'sonnet' },
    })
  })

  it('leaves the model out when the line has none', () => {
    expect(parseAgentLine('Agent: opencode laptop-headless')).toEqual({
      state: 'set',
      choice: { agent: 'opencode', target: 'laptop-headless', model: null },
    })
  })

  it('accepts the model slugs a start accepts', () => {
    const modelOf = (line: string) => {
      const parsed = parseAgentLine(line)
      return parsed.state === 'set' ? parsed.choice.model : parsed
    }
    expect(modelOf('Agent: opencode laptop-headless opencode/big-pickle')).toBe('opencode/big-pickle')
    expect(modelOf('Agent: claude laptop-headless anthropic/claude-sonnet-4.5')).toBe('anthropic/claude-sonnet-4.5')
    expect(modelOf('Agent: claude laptop-remote-control opus')).toBe('opus')
  })

  it('says a body without the line has none', () => {
    expect(parseAgentLine('No agent here.\nAgents: claude')).toEqual({ state: 'missing' })
    expect(parseAgentLine('')).toEqual({ state: 'missing' })
  })

  it.each([
    ['Agent: gemini laptop-headless', 'gemini'],
    ['Agent: claude my-laptop', 'my-laptop'],
    ['Agent: claude laptop-headless gpt', 'gpt'],
    ['Agent: opencode laptop-remote-control', 'OpenCode'],
    ['Agent: claude laptop-remote-control openai/gpt-5-mini', 'OpenRouter'],
    ['Agent: claude cloud-routine sonnet', 'cloud routine'],
    ['Agent: claude', 'target'],
    ['Agent:', 'agent'],
    ['Agent: claude laptop-headless sonnet extra', 'extra'],
  ])('reports %j as a problem naming %s', (line, mention) => {
    const parsed = parseAgentLine(line)
    expect(parsed.state).toBe('invalid')
    expect(parsed.state === 'invalid' && parsed.problem).toContain(mention)
    expect(parsed.state === 'invalid' && parsed.text).toBe(line)
  })

  it('reads the first line when the body has two', () => {
    expect(parseAgentLine('Agent: claude laptop-headless\nAgent: opencode laptop-headless')).toMatchObject({
      state: 'set',
      choice: { agent: 'claude' },
    })
  })

  it('ignores carriage returns of a Windows body', () => {
    expect(parseAgentLine('Intro\r\nAgent: claude laptop-headless sonnet\r\nMore')).toMatchObject({ state: 'set', choice: { model: 'sonnet' } })
  })
})

describe('bodyWithAgentLine', () => {
  const choice = { agent: 'opencode', target: 'laptop-headless', model: 'opencode/big-pickle' } as const

  it('replaces the line and leaves every other character of the body alone', () => {
    const body = '## What\r\n\r\nText  with   spaces\r\nAgent: claude laptop-headless sonnet\r\n\r\n- [ ] one\r\n'
    expect(bodyWithAgentLine(body, choice)).toBe(
      '## What\r\n\r\nText  with   spaces\r\nAgent: opencode laptop-headless opencode/big-pickle\r\n\r\n- [ ] one\r\n',
    )
  })

  it('writes a line without a model when the choice has none', () => {
    expect(bodyWithAgentLine('Agent: claude laptop-headless sonnet', { agent: 'claude', target: 'cloud-routine', model: null })).toBe(
      'Agent: claude cloud-routine',
    )
  })

  it('appends the line after a blank line when the body has none', () => {
    expect(bodyWithAgentLine('## What\n\nText\n', choice)).toBe('## What\n\nText\n\nAgent: opencode laptop-headless opencode/big-pickle\n')
  })

  it('writes just the line into an empty body', () => {
    expect(bodyWithAgentLine('', choice)).toBe('Agent: opencode laptop-headless opencode/big-pickle\n')
  })

  it('round-trips through the parser', () => {
    expect(parseAgentLine(bodyWithAgentLine('Intro', choice))).toEqual({ state: 'set', choice })
  })

  it('replaces an invalid line too', () => {
    expect(bodyWithAgentLine('Agent: gemini nowhere\nrest', choice)).toBe('Agent: opencode laptop-headless opencode/big-pickle\nrest')
  })
})
