import { describe, expect, it } from 'vitest'
import { catalogProviderKey, toOpenCodeModels } from '../server/openai-compatible/catalog'

const fallbackApi = 'https://opencode.ai/inference/go/openai/v1'

// One model per provider package, plus the edge cases: no provider, an SDK we
// cannot build (mistral) and a model that cannot call tools
const catalog = {
  'opencode-go': {
    models: {
      'deepseek-v4.1-flash': { name: 'DeepSeek V4.1 Flash', tool_call: true, provider: { npm: '@ai-sdk/openai-compatible' } },
      'gpt-5.2': { name: 'GPT-5.2', tool_call: true, provider: { npm: '@ai-sdk/openai', api: 'https://opencode.ai/inference/go/openai/v1' } },
      'claude-haiku-5-5': { name: 'Claude Haiku 5.5', tool_call: true, provider: { npm: '@ai-sdk/anthropic', api: 'https://opencode.ai/inference/go/anthropic/v1' } },
      'gemini-4-argon-contributor': { name: 'Gemini 4 Argon Contributor', tool_call: true, provider: { npm: '@ai-sdk/google', api: 'https://opencode.ai/inference/go/google/v1beta' } },
      'glm-5.3': { name: 'GLM 5.3', tool_call: true },
      'mistral-large-3': { name: 'Mistral Large 3', tool_call: true, provider: { npm: '@ai-sdk/mistral' } },
      'text-embedding-4': { name: 'Text Embedding 4', tool_call: false, provider: { npm: '@ai-sdk/openai-compatible' } }
    }
  },
  'opencode': { models: {} }
}

describe('catalogProviderKey', () => {
  it('reads the OpenCode Go key from a Go base URL', () => {
    expect(catalogProviderKey('https://opencode.ai/inference/go/openai/v1')).toBe('opencode-go')
  })

  it('uses the Zen key for every other base URL', () => {
    expect(catalogProviderKey('https://opencode.ai/inference/openai/v1')).toBe('opencode')
    expect(catalogProviderKey('')).toBe('opencode')
  })
})

describe('toOpenCodeModels', () => {
  it('maps every provider package to its SDK', () => {
    const models = toOpenCodeModels(catalog, 'opencode-go', fallbackApi)

    expect(models.get('deepseek-v4.1-flash')).toMatchObject({ sdk: 'openai-compatible', api: fallbackApi })
    expect(models.get('gpt-5.2')).toMatchObject({ sdk: 'openai-responses', api: 'https://opencode.ai/inference/go/openai/v1' })
    expect(models.get('claude-haiku-5-5')).toMatchObject({ sdk: 'anthropic', api: 'https://opencode.ai/inference/go/anthropic/v1' })
    expect(models.get('gemini-4-argon-contributor')).toMatchObject({ sdk: 'google', api: 'https://opencode.ai/inference/go/google/v1beta' })
  })

  it('keeps the name and the tool-calling flag', () => {
    const models = toOpenCodeModels(catalog, 'opencode-go', fallbackApi)

    expect(models.get('deepseek-v4.1-flash')).toEqual({
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      sdk: 'openai-compatible',
      api: fallbackApi,
      toolCall: true
    })
    expect(models.get('text-embedding-4')?.toolCall).toBe(false)
  })

  it('treats a model without a provider as chat completions on the fallback API', () => {
    const model = toOpenCodeModels(catalog, 'opencode-go', fallbackApi).get('glm-5.3')

    expect(model).toMatchObject({ sdk: 'openai-compatible', api: fallbackApi })
  })

  it('skips an SDK it cannot build', () => {
    expect(toOpenCodeModels(catalog, 'opencode-go', fallbackApi).has('mistral-large-3')).toBe(false)
  })

  it('reads only the requested provider key', () => {
    expect(toOpenCodeModels(catalog, 'opencode', fallbackApi).size).toBe(0)
  })

  it('returns an empty map for malformed input', () => {
    expect(toOpenCodeModels(null, 'opencode-go', fallbackApi).size).toBe(0)
    expect(toOpenCodeModels({}, 'opencode-go', fallbackApi).size).toBe(0)
    expect(toOpenCodeModels({ 'opencode-go': { models: 'nope' } }, 'opencode-go', fallbackApi).size).toBe(0)
    expect(toOpenCodeModels({ 'opencode-go': { models: { broken: null } } }, 'opencode-go', fallbackApi).size).toBe(0)
  })

  it('falls back to the id when the catalog has no name', () => {
    const models = toOpenCodeModels({ 'opencode-go': { models: { odd: { tool_call: true } } } }, 'opencode-go', fallbackApi)

    expect(models.get('odd')).toMatchObject({ name: 'odd', api: fallbackApi })
  })
})
