import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openAICompatibleConnector, openCodeConnector } from '../server/openai-compatible/connectors'
import type { SetupValues } from '../../core/shared/types/setup'

const catalog = {
  'opencode-go': {
    models: {
      'deepseek-v4.1-flash': { name: 'DeepSeek V4.1 Flash', tool_call: true, provider: { npm: '@ai-sdk/openai-compatible' } },
      'glm-5.3': { name: 'GLM 5.3', tool_call: true },
      'text-embedding-4': { name: 'Text Embedding 4', tool_call: false, provider: { npm: '@ai-sdk/openai-compatible' } }
    }
  }
}

const listed = {
  data: [{ id: 'glm-5.3' }, { id: 'deepseek-v4.1-flash' }, { id: 'text-embedding-4' }]
}

const openCodeValues: SetupValues = {
  baseUrl: 'https://opencode.ai/inference/go/openai/v1',
  apiKey: 'secret-key',
  model: 'deepseek-v4.1-flash'
}

let stored: Map<string, unknown>

beforeEach(() => {
  stored = new Map()
  vi.stubGlobal('useStorage', () => ({
    getMounts: () => [],
    getItem: async (key: string) => stored.get(key),
    setItem: async (key: string, value: unknown) => {
      stored.set(key, value)
    }
  }))
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const body = String(input).includes('models.dev') ? catalog : listed
    return { ok: true, status: 200, json: async () => body }
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fieldOptions', () => {
  it('offers the OpenCode models by catalog name, limited to tool calling', async () => {
    await expect(openCodeConnector.fieldOptions!('model', openCodeValues)).resolves.toEqual([
      { label: 'DeepSeek V4.1 Flash', value: 'deepseek-v4.1-flash', description: 'deepseek-v4.1-flash' },
      { label: 'GLM 5.3', value: 'glm-5.3', description: 'glm-5.3' }
    ])
  })

  it('offers the generic endpoint models by id', async () => {
    await expect(openAICompatibleConnector.fieldOptions!('model', { baseUrl: 'http://host.docker.internal:11434/v1' }))
      .resolves.toEqual([
        { label: 'deepseek-v4.1-flash', value: 'deepseek-v4.1-flash' },
        { label: 'glm-5.3', value: 'glm-5.3' },
        { label: 'text-embedding-4', value: 'text-embedding-4' }
      ])
  })

  it('knows no options for another field', async () => {
    await expect(openCodeConnector.fieldOptions!('baseUrl', openCodeValues)).resolves.toEqual([])
    await expect(openAICompatibleConnector.fieldOptions!('baseUrl', openCodeValues)).resolves.toEqual([])
  })

  it('sends the key of the values it was given', async () => {
    await openAICompatibleConnector.fieldOptions!('model', { baseUrl: 'http://localhost:11434/v1', apiKey: 'key' })

    const fetchMock = vi.mocked(fetch)
    const [, init] = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/models'))!
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer key')
  })
})
