import { describe, expect, it } from 'vitest'
import { toAiModelInfos } from '../server/openai-compatible/models'

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
