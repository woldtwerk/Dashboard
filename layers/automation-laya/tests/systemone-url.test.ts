import { describe, expect, it } from 'vitest'
import { systemOneBaseUrl } from '../server/laya/systemone-url'

describe('systemOneBaseUrl', () => {
  it('maps the Go base to the System One base', () => {
    expect(systemOneBaseUrl('https://opencode.ai/inference/go/openai/v1'))
      .toBe('https://opencode.ai/inference/go/systemone')
  })

  it('maps the pay-as-you-go base and tolerates a trailing slash', () => {
    expect(systemOneBaseUrl('https://opencode.ai/inference/openai/v1/'))
      .toBe('https://opencode.ai/inference/systemone')
  })

  it('rejects a base without the OpenAI suffix', () => {
    expect(() => systemOneBaseUrl('https://opencode.ai/inference/openai')).toThrow('/openai/v1')
  })
})
