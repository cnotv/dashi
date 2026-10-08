import { describe, expect, it } from 'vitest'
import { cloudSessionIdOf, cloudSessionIdOfUrl, recordCloudHook } from './cloud-conversations.ts'
import type { CloudConversationState } from './types.ts'

const emptyState: CloudConversationState = { conversations: new Map(), cloudSessionByHookSession: new Map() }

describe('cloud session ids', () => {
  it('reads the hook header and a start link as the same session', () => {
    expect(cloudSessionIdOf('cse_01HJKLMNOP')).toBe('session_01HJKLMNOP')
    expect(cloudSessionIdOf('session_01HJKLMNOP')).toBe('session_01HJKLMNOP')
    expect(cloudSessionIdOfUrl('https://claude.ai/code/session_01HJKLMNOP?from=cli')).toBe('session_01HJKLMNOP')
  })

  it('takes nothing that is not a cloud session id', () => {
    expect(cloudSessionIdOf(undefined)).toBeNull()
    expect(cloudSessionIdOf('')).toBeNull()
    expect(cloudSessionIdOf('cse_01/../x')).toBeNull()
    expect(cloudSessionIdOfUrl('https://claude.ai/code')).toBeNull()
    expect(cloudSessionIdOfUrl('https://example.com/code/session_01HJKLMNOP')).toBeNull()
  })
})

describe('recordCloudHook', () => {
  it('keeps the latest 150 messages of a session, each clipped, and skips empty ones', () => {
    const state = Array.from({ length: 160 }, (_, index) => index).reduce(
      (current, index) => recordCloudHook(current, 'hook-1', 'session_01A', { role: 'assistant', text: `Reply ${index}` }, index),
      recordCloudHook(emptyState, 'hook-1', 'session_01A', { role: 'user', text: 'x'.repeat(5000) }, 0),
    )
    const messages = state.conversations.get('session_01A')?.messages ?? []
    expect(messages).toHaveLength(150)
    expect(messages.at(-1)?.text).toBe('Reply 159')
    expect(recordCloudHook(state, 'hook-1', 'session_01A', { role: 'user', text: '  ' }, 200).conversations.get('session_01A')?.messages).toHaveLength(150)
    expect(recordCloudHook(emptyState, 'hook-1', 'session_01A', { role: 'user', text: 'x'.repeat(5000) }, 0).conversations.get('session_01A')?.messages[0]?.text).toHaveLength(4001)
  })

  it('keeps the 200 most recently heard sessions, and forgets the hook ids of the ones it drops', () => {
    const state = Array.from({ length: 201 }, (_, index) => index).reduce(
      (current, index) => recordCloudHook(current, `hook-${index}`, `session_${index}`, null, index),
      emptyState,
    )
    expect(state.conversations.size).toBe(200)
    expect(state.conversations.has('session_0')).toBe(false)
    expect(state.cloudSessionByHookSession.has('hook-0')).toBe(false)
    expect(state.cloudSessionByHookSession.get('hook-200')).toBe('session_200')
  })
})
