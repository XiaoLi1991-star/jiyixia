import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestChatCompletion } from './modelClient'
import type { ModelSettings } from '@/types'

const minimaxSettings: ModelSettings = {
  baseUrl: 'https://api.minimaxi.com/v1',
  model: 'MiniMax-M2.7-highspeed',
  requestPath: '/chat/completions',
  temperature: 0,
  maxTokens: 123,
  timeoutMs: 1000
}

describe('model client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the MiniMax token field and reads chat content', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: '{"records":[]}' } }]
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestChatCompletion(minimaxSettings, 'test-key', [
      { role: 'user', content: '停车12' }
    ])

    expect(result.content).toBe('{"records":[]}')
    expect(fetchMock).toHaveBeenCalledWith('https://api.minimaxi.com/v1/chat/completions', expect.objectContaining({
      method: 'POST'
    }))
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(init.body as string)
    expect(body.max_completion_tokens).toBe(123)
    expect(body.max_tokens).toBeUndefined()
    expect(body.temperature).toBe(0.1)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
  })
})
