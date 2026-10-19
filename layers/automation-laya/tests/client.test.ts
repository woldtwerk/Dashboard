import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLayaClient } from '../server/laya/client'
import type { DecisionQuestion } from '../../automation/shared/types/automation'

const questions: Record<string, DecisionQuestion> = {
  urgent: { type: 'yesno', instructions: 'Is this urgent?' }
}

const response = (answers: Record<string, unknown>) => new Response(JSON.stringify({ model: 'm', answers, usage: {} }), {
  headers: { 'content-type': 'application/json' }
})

const noul = { urgent: { type: 'noul', noul: 0.9, answer_confidence: 0.9 } }

interface Call { url: string, init: RequestInit }

function recordingFetch(handler: (call: Call, index: number) => Response): { fetch: typeof fetch, calls: Call[] } {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    return handler(call, calls.length - 1)
  })
  return { fetch: fetchMock as unknown as typeof fetch, calls }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createLayaClient', () => {
  it('posts to /v1/systemone with the bearer and mapped body', async () => {
    const { fetch, calls } = recordingFetch(() => response(noul))
    const client = createLayaClient({ url: 'http://laya:8000/', apiKey: 'secret', request: { maxLen: 2048 }, fetch })

    const answers = await client.systemOne('the mail', questions)

    expect(answers).toEqual({ urgent: { yes: 0.9, confidence: 0.9 } })
    expect(calls[0]!.url).toBe('http://laya:8000/v1/systemone')
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer secret')
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      state: 'the mail',
      max_len: 2048,
      questions: { urgent: { type: 'noul', instructions: 'Is this urgent?' } }
    })
  })

  it('omits the bearer when no key is configured', async () => {
    const { fetch, calls } = recordingFetch(() => response(noul))
    await createLayaClient({ url: 'http://laya:8000', fetch }).systemOne('x', questions)
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBeNull()
  })

  it('retries a 503 after Retry-After', async () => {
    const { fetch, calls } = recordingFetch((_call, index) => index === 0
      ? new Response('busy', { status: 503, headers: { 'retry-after': '0' } })
      : response(noul))

    const answers = await createLayaClient({ url: 'http://laya:8000', fetch }).systemOne('x', questions)

    expect(calls).toHaveLength(2)
    expect(answers.urgent!.yes).toBe(0.9)
  })

  it('gives up after the retry budget', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('busy', { status: 503, headers: { 'retry-after': '0' } }))

    await expect(createLayaClient({ url: 'http://laya:8000', fetch, maxRetries: 1 }).systemOne('x', questions))
      .rejects.toThrow('laya-serve answered 503')
    expect(calls).toHaveLength(2)
  })

  it('reports a non-retryable status', async () => {
    const { fetch } = recordingFetch(() => new Response('bad', { status: 422 }))
    await expect(createLayaClient({ url: 'http://laya:8000', fetch }).systemOne('x', questions))
      .rejects.toThrow('laya-serve answered 422')
  })

  it('chunks a batch into requests of at most 64 states', async () => {
    const { fetch, calls } = recordingFetch(() => new Response(JSON.stringify({
      results: [1, 2].map(() => ({ model: 'm', answers: noul, usage: {} }))
    }), { headers: { 'content-type': 'application/json' } }))

    const client = createLayaClient({ url: 'http://laya:8000', fetch })
    const answers = await client.systemOneBatch(Array.from({ length: 130 }, (_, index) => `state ${index}`), questions)

    expect(calls).toHaveLength(3)
    expect(calls.every(call => call.url.endsWith('/v1/systemone/batch'))).toBe(true)
    // The stub returns two results per request; three requests yield six
    expect(answers).toHaveLength(6)
  })

  it('retries once when the call is aborted, then succeeds', async () => {
    const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
    const { fetch, calls } = recordingFetch((_call, index) => {
      if (index === 0) {
        throw abort
      }
      return response(noul)
    })

    const answers = await createLayaClient({ url: 'http://laya:8000', fetch }).systemOne('x', questions)

    expect(calls).toHaveLength(2)
    expect(answers.urgent!.yes).toBe(0.9)
  })

  it('gives up after one abort retry', async () => {
    const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
    const { fetch, calls } = recordingFetch(() => {
      throw abort
    })

    await expect(createLayaClient({ url: 'http://laya:8000', fetch }).systemOne('x', questions))
      .rejects.toThrow('aborted')
    expect(calls).toHaveLength(2)
  })

  it('returns nothing for an empty batch', async () => {
    const { fetch, calls } = recordingFetch(() => response(noul))
    expect(await createLayaClient({ url: 'http://laya:8000', fetch }).systemOneBatch([], questions)).toEqual([])
    expect(calls).toHaveLength(0)
  })
})
