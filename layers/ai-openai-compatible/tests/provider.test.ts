import { describe, expect, it } from 'vitest'
import { resolveOpenCodeModel, selectOpenCodeSdk } from '../server/openai-compatible/provider'
import type { OpenCodeModelMeta } from '../server/openai-compatible/catalog'

const baseUrl = 'https://opencode.ai/inference/go/openai/v1'

function meta(overrides: Partial<OpenCodeModelMeta>): OpenCodeModelMeta {
  return { id: 'model', name: 'Model', sdk: 'openai-compatible', api: baseUrl, toolCall: true, ...overrides }
}

describe('selectOpenCodeSdk', () => {
  it('uses the catalog endpoint of each SDK', () => {
    expect(selectOpenCodeSdk(meta({ sdk: 'openai-responses', api: 'https://opencode.ai/inference/go/openai/v1' }), baseUrl))
      .toEqual({ sdk: 'openai-responses', api: 'https://opencode.ai/inference/go/openai/v1' })
    expect(selectOpenCodeSdk(meta({ sdk: 'anthropic', api: 'https://opencode.ai/inference/go/anthropic/v1' }), baseUrl))
      .toEqual({ sdk: 'anthropic', api: 'https://opencode.ai/inference/go/anthropic/v1' })
    expect(selectOpenCodeSdk(meta({ sdk: 'google', api: 'https://opencode.ai/inference/go/google/v1beta' }), baseUrl))
      .toEqual({ sdk: 'google', api: 'https://opencode.ai/inference/go/google/v1beta' })
  })

  it('uses the configured base URL for chat completions', () => {
    expect(selectOpenCodeSdk(meta({ sdk: 'openai-compatible', api: 'https://elsewhere.example/v1' }), baseUrl))
      .toEqual({ sdk: 'openai-compatible', api: baseUrl })
  })

  it('tries an unknown model as chat completions on the configured base URL', () => {
    expect(selectOpenCodeSdk(undefined, baseUrl)).toEqual({ sdk: 'openai-compatible', api: baseUrl })
  })

  it('refuses an endpoint on another host, so the key stays where it belongs', () => {
    expect(() => selectOpenCodeSdk(meta({ sdk: 'anthropic', api: 'https://attacker.example/anthropic/v1' }), baseUrl))
      .toThrowError('Model endpoint is not on the configured host')
  })
})

describe('resolveOpenCodeModel', () => {
  const catalog = {
    'opencode-go': {
      models: {
        'claude-haiku-5-5': {
          name: 'Claude Haiku 5.5',
          tool_call: true,
          provider: { npm: '@ai-sdk/anthropic', api: 'https://opencode.ai/inference/go/anthropic/v1' }
        }
      }
    }
  }

  it('falls back to chat completions when the catalog cannot be loaded', async () => {
    const failing = () => Promise.reject(new Error('models.dev is down'))

    await expect(resolveOpenCodeModel(failing, baseUrl, 'claude-haiku-5-5'))
      .resolves.toEqual({ sdk: 'openai-compatible', api: baseUrl })
  })

  it('takes the SDK and endpoint from the catalog', async () => {
    await expect(resolveOpenCodeModel(() => Promise.resolve(catalog), baseUrl, 'claude-haiku-5-5'))
      .resolves.toEqual({ sdk: 'anthropic', api: 'https://opencode.ai/inference/go/anthropic/v1' })
  })
})
