import { describe, expect, it } from 'vitest'
import type { ChatDelivery, SessionChat, SessionStart } from '@dashi/contracts'
import { canChatWithStart, chatTimelineOf } from './session-chat'

const delivery = (overrides: Partial<ChatDelivery>): ChatDelivery => ({
  deliveryId: 'd1',
  text: 'Also update the docs',
  state: 'delivered',
  message: null,
  createdAt: '2026-09-30T10:01:00Z',
  ...overrides,
})

const chatWith = (deliveries: ChatDelivery[], typedAt: string | null): SessionChat => ({
  sessionId: 's1',
  availability: 'on-laptop',
  deliveryRoute: 'tmux',
  sendBlocker: null,
  messages: [
    { messageId: 'm1', role: 'user', kind: 'text', text: 'Fix it', toolName: null, createdAt: '2026-09-30T10:00:00Z' },
    ...(typedAt === null
      ? []
      : [
          {
            messageId: 'm2',
            role: 'user' as const,
            kind: 'text' as const,
            text: 'Also update the docs',
            toolName: null,
            createdAt: typedAt,
          },
        ]),
  ],
  deliveries,
  updatedAt: null,
})

describe('chatTimelineOf', () => {
  it('shows a sent message until the transcript has it', () => {
    expect(chatTimelineOf(chatWith([delivery({ state: 'sent' })], null)).map((item) => item.itemKey)).toEqual(['m1', 'd1'])
    expect(chatTimelineOf(chatWith([delivery({})], null)).map((item) => item.itemKey)).toEqual(['m1', 'd1'])
    expect(chatTimelineOf(chatWith([delivery({})], '2026-09-30T10:01:02Z')).map((item) => item.itemKey)).toEqual(['m1', 'm2'])
  })

  it('keeps a failed message, and does not take an older identical message for the delivered one', () => {
    expect(chatTimelineOf(chatWith([delivery({ state: 'failed' })], '2026-09-30T10:01:02Z')).map((item) => item.itemKey)).toEqual([
      'm1',
      'm2',
      'd1',
    ])
    expect(chatTimelineOf(chatWith([delivery({})], '2026-09-30T09:00:00Z')).map((item) => item.itemKey)).toEqual(['m1', 'm2', 'd1'])
  })
})

describe('canChatWithStart', () => {
  const start: SessionStart = {
    startId: 'start-1',
    repository: { owner: 'cnotv', name: 'example' },
    issueNumber: 12,
    pullRequestNumber: null,
    workflow: 'feature',
    target: 'cloud-routine',
    permissionMode: 'auto',
    note: '',
    state: 'started',
    runnerLabel: null,
    sessionUrl: 'https://claude.ai/code/session_01HJKLMNOP',
    message: null,
    createdAt: '2026-10-08T10:00:00Z',
    updatedAt: '2026-10-08T10:00:00Z',
  }

  it('opens a cloud start once claude.ai has given its session link', () => {
    expect(canChatWithStart(start)).toBe(true)
    expect(canChatWithStart({ ...start, target: 'laptop-cloud' })).toBe(true)
    expect(canChatWithStart({ ...start, sessionUrl: null })).toBe(false)
    expect(canChatWithStart({ ...start, sessionUrl: 'https://claude.ai/code' })).toBe(false)
    expect(canChatWithStart({ ...start, state: 'failed' })).toBe(false)
  })

  it('opens a started laptop start, which the runner reads', () => {
    expect(canChatWithStart({ ...start, target: 'laptop-headless', sessionUrl: null })).toBe(true)
  })
})
