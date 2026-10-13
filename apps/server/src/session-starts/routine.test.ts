import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireRoutine } from './routine.ts'

const routineToken = 'sk-ant-oat01-exampleRoutineToken0123456789'

afterEach(() => vi.unstubAllGlobals())

describe('fireRoutine', () => {
  it('posts the text with the routine token and returns the session link', async () => {
    const receivedRequests: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      receivedRequests.push({ url, init })
      return Response.json({
        type: 'routine_fire',
        claude_code_session_id: 'session_01X',
        claude_code_session_url: 'https://claude.ai/code/session_01X',
      })
    })
    expect(await fireRoutine('trig_01ABCDEFGHJK', routineToken, '/workflow:start')).toEqual({
      ok: true,
      sessionUrl: 'https://claude.ai/code/session_01X',
    })
    expect(receivedRequests[0]?.url).toBe('https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEFGHJK/fire')
    expect(receivedRequests[0]?.init.headers).toMatchObject({ Authorization: `Bearer ${routineToken}`, 'anthropic-version': '2023-06-01' })
    expect(receivedRequests[0]?.init.body).toBe(JSON.stringify({ text: '/workflow:start' }))
  })

  it("passes on the API's reason when it refuses", async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ type: 'error', error: { type: 'rate_limit_error', message: 'Hourly limit reached' } }, { status: 429 }),
    )
    expect(await fireRoutine('trig_01ABCDEFGHJK', routineToken, 'x')).toEqual({ ok: false, message: 'Hourly limit reached' })
  })
})
