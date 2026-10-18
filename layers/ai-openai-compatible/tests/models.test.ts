import { describe, expect, it } from 'vitest'
import { modelsUrl, toAiModelInfos } from '../server/openai-compatible/models'

describe('toAiModelInfos', () => {
  it('maps, sorts and deduplicates the OpenAI models payload', () => {
    expect(toAiModelInfos({
      object: 'list',
      data: [
        { id: 'kimi-k3', object: 'model' },
        { id: 'deepseek-v4.1-flash' },
        { id: 'kimi-k3' },
        { id: 'glm-5.3' }
      ]
    })).toEqual([
      { id: 'deepseek-v4.1-flash', label: 'deepseek-v4.1-flash' },
      { id: 'glm-5.3', label: 'glm-5.3' },
      { id: 'kimi-k3', label: 'kimi-k3' }
    ])
  })

  it('trims ids and drops blank or non-string ones', () => {
    expect(toAiModelInfos({ data: [{ id: '  a  ' }, { id: '' }, { id: '   ' }, { id: 7 }, {}, null] })).toEqual([
      { id: 'a', label: 'a' }
    ])
  })

  it('returns an empty list for an unexpected payload', () => {
    expect(toAiModelInfos(null)).toEqual([])
    expect(toAiModelInfos({})).toEqual([])
    expect(toAiModelInfos({ data: 'nope' })).toEqual([])
  })
})

describe('modelsUrl', () => {
  it('points at the shared list one level above an OpenCode Go base', () => {
    expect(modelsUrl('https://opencode.ai/inference/go/openai/v1'))
      .toBe('https://opencode.ai/inference/go/v1/models')
  })

  it('points at the shared list one level above an OpenCode Zen base', () => {
    expect(modelsUrl('https://opencode.ai/inference/openai/v1'))
      .toBe('https://opencode.ai/inference/v1/models')
  })

  it('appends /models to a plain OpenAI-compatible base, e.g. Ollama', () => {
    expect(modelsUrl('http://host.docker.internal:11434/v1'))
      .toBe('http://host.docker.internal:11434/v1/models')
  })

  it('ignores trailing slashes and repeated slashes', () => {
    expect(modelsUrl('https://opencode.ai/inference/go/openai/v1/'))
      .toBe('https://opencode.ai/inference/go/v1/models')
    expect(modelsUrl('http://host.docker.internal:11434/v1///'))
      .toBe('http://host.docker.internal:11434/v1/models')
  })
})
