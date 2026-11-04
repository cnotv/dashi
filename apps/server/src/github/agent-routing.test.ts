import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { TicketAgentLine } from '@dashi/contracts'
import { loadAgentRouting, parseAgentRouting, proposeAgentLine } from './agent-routing.ts'

const routingFile = fileURLToPath(new URL('../../../../config/agent-routing.json', import.meta.url))
const defaultRouting = loadAgentRouting(routingFile)
const missing: TicketAgentLine = { state: 'missing' }

const choiceFor = (labelNames: string[]) => {
  const line = proposeAgentLine(missing, labelNames.map((name) => ({ name, color: 'ffffff' })), defaultRouting)
  if (line.state !== 'proposed') throw new Error(`expected a proposal, got ${line.state}`)
  return line.choice
}

describe('the default routing file', () => {
  it('sends security, auth and secrets work to Claude Opus, unattended, never a free model', () => {
    ;['security', 'auth', 'secrets'].forEach((label) => {
      expect(choiceFor([label])).toEqual({ agent: 'claude', target: 'laptop-headless', model: 'opus' })
    })
  })

  it('plans an epic with Claude Opus on the laptop, steered from the phone', () => {
    expect(choiceFor(['epic'])).toEqual({ agent: 'claude', target: 'laptop-remote-control', model: 'opus' })
  })

  it('takes design and UI work with Claude on the laptop, steered from the phone', () => {
    expect(choiceFor(['design'])).toEqual({ agent: 'claude', target: 'laptop-remote-control', model: null })
    expect(choiceFor(['ui'])).toEqual({ agent: 'claude', target: 'laptop-remote-control', model: null })
  })

  it('gives a small chore, docs or tests ticket to OpenCode on a free model, unattended', () => {
    ;['chore', 'documentation', 'tests'].forEach((label) => {
      expect(choiceFor([label])).toMatchObject({ agent: 'opencode', target: 'laptop-headless', model: 'opencode/big-pickle' })
    })
  })

  it('reviews a pull request with a model other than the feature default', () => {
    const reviewModel = choiceFor(['review']).model
    expect(reviewModel).not.toBeNull()
    expect(reviewModel).not.toBe(choiceFor(['enhancement']).model)
  })

  it('runs a feature or a fix, and anything unlabelled, on Claude Sonnet unattended', () => {
    ;[['enhancement'], ['bug'], [], ['question']].forEach((labelNames) => {
      expect(choiceFor(labelNames)).toEqual({ agent: 'claude', target: 'laptop-headless', model: 'sonnet' })
    })
  })

  it('lets the first rule in the file win, so security beats a chore label', () => {
    expect(choiceFor(['chore', 'security']).model).toBe('opus')
  })

  it('reads a label without regard to case', () => {
    expect(choiceFor(['Security']).model).toBe('opus')
  })
})

describe('proposeAgentLine', () => {
  const line: TicketAgentLine = { state: 'set', choice: { agent: 'opencode', target: 'laptop-headless', model: null } }

  it('leaves an explicit Agent: line as it is, whatever the labels say', () => {
    expect(proposeAgentLine(line, [{ name: 'security', color: 'ffffff' }], defaultRouting)).toBe(line)
  })

  it('leaves a wrong Agent: line as a problem instead of overriding what the owner wrote', () => {
    const invalid: TicketAgentLine = { state: 'invalid', text: 'Agent: gemini x', problem: 'Unknown agent' }
    expect(proposeAgentLine(invalid, [], defaultRouting)).toBe(invalid)
  })

  it('says why the proposal was made', () => {
    expect(proposeAgentLine(missing, [{ name: 'security', color: 'ffffff' }], defaultRouting)).toMatchObject({
      state: 'proposed',
      reason: expect.stringContaining('free model'),
    })
  })
})

describe('parseAgentRouting', () => {
  const validFile = JSON.parse(readFileSync(routingFile, 'utf8'))
  const withRules = (rules: unknown[]) => JSON.stringify({ ...validFile, rules })
  const rule = { name: 'x', labels: ['x'], agent: 'claude', target: 'laptop-headless', model: null, reason: 'Because' }

  it('accepts the shipped file', () => {
    expect(() => parseAgentRouting(JSON.stringify(validFile))).not.toThrow()
  })

  it('fails loudly on text that is not JSON', () => {
    expect(() => parseAgentRouting('{')).toThrow()
  })

  it('fails on an agent a start does not accept', () => {
    expect(() => parseAgentRouting(withRules([{ ...rule, agent: 'gemini' }]))).toThrow()
  })

  it('fails on a choice a start would refuse, such as OpenCode in a cloud routine', () => {
    expect(() => parseAgentRouting(withRules([{ ...rule, agent: 'opencode', target: 'cloud-routine' }]))).toThrow(/OpenCode runs only/)
  })

  it('fails on a model the agent cannot run', () => {
    expect(() => parseAgentRouting(withRules([{ ...rule, model: 'not a model' }]))).toThrow(/Unknown model/)
  })

  it('fails on a rule that matches no label, which would shadow every rule after it', () => {
    expect(() => parseAgentRouting(withRules([{ ...rule, labels: [] }]))).toThrow()
  })

  it('fails on a misspelt key instead of ignoring it', () => {
    expect(() => parseAgentRouting(withRules([{ ...rule, modle: 'opus' }]))).toThrow()
  })

  it('fails when the fallback is missing', () => {
    expect(() => parseAgentRouting(JSON.stringify({ rules: [rule] }))).toThrow()
  })
})
