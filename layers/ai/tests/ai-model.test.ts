import { describe, expect, it } from 'vitest'
import { buildModelChoices, isAiModelAllowed, parseModelParam, resolveModelSelection, serializeModelParam } from '../shared/ai-model'
import type { AiServiceModels } from '../shared/types/ai'

const services: AiServiceModels[] = [
  {
    service: { id: 'svc-a', name: 'Work' },
    defaultModel: 'kimi-k3',
    models: [
      { id: 'glm-5.3', label: 'glm-5.3' },
      { id: 'kimi-k3', label: 'kimi-k3' }
    ]
  },
  {
    service: { id: 'svc-b', name: 'Local' },
    defaultModel: 'qwen3:8b',
    models: [{ id: 'qwen3:8b', label: 'qwen3:8b' }]
  }
]

describe('parseModelParam', () => {
  it('reads a service and model from the query param', () => {
    expect(parseModelParam('svc-a:glm-5.3')).toEqual({ serviceId: 'svc-a', modelId: 'glm-5.3' })
  })

  it('keeps a colon inside the model id', () => {
    expect(parseModelParam('svc-b:qwen3:8b')).toEqual({ serviceId: 'svc-b', modelId: 'qwen3:8b' })
  })

  it('rejects malformed values', () => {
    expect(parseModelParam(undefined)).toBeUndefined()
    expect(parseModelParam('')).toBeUndefined()
    expect(parseModelParam('nocolon')).toBeUndefined()
    expect(parseModelParam(':model')).toBeUndefined()
    expect(parseModelParam('service:')).toBeUndefined()
    expect(parseModelParam(['svc-a:glm-5.3'])).toBeUndefined()
  })
})

describe('serializeModelParam', () => {
  it('round-trips with parseModelParam', () => {
    const selection = parseModelParam('svc-a:glm-5.3')!
    expect(serializeModelParam(selection)).toBe('svc-a:glm-5.3')
  })

  it('is undefined without a selection', () => {
    expect(serializeModelParam(undefined)).toBeUndefined()
  })
})

describe('isAiModelAllowed', () => {
  it('accepts a listed model and the configured default', () => {
    expect(isAiModelAllowed('glm-5.3', 'kimi-k3', services[0]!.models)).toBe(true)
    expect(isAiModelAllowed('kimi-k3', 'kimi-k3', services[0]!.models)).toBe(true)
  })

  it('rejects an unknown model', () => {
    expect(isAiModelAllowed('gpt-5', 'kimi-k3', services[0]!.models)).toBe(false)
  })

  it('still accepts the configured default when the provider listed nothing', () => {
    expect(isAiModelAllowed('kimi-k3', 'kimi-k3', [])).toBe(true)
    expect(isAiModelAllowed('glm-5.3', 'kimi-k3', [])).toBe(false)
  })
})

describe('resolveModelSelection', () => {
  it('keeps a known service and model', () => {
    expect(resolveModelSelection(services, { serviceId: 'svc-b', modelId: 'qwen3:8b' })).toEqual({ serviceId: 'svc-b', modelId: 'qwen3:8b' })
  })

  it('falls back to the first service default for unknown values', () => {
    expect(resolveModelSelection(services, { serviceId: 'nope', modelId: 'x' })).toEqual({ serviceId: 'svc-a', modelId: 'kimi-k3' })
    expect(resolveModelSelection(services, { serviceId: 'svc-a', modelId: 'gpt-5' })).toEqual({ serviceId: 'svc-a', modelId: 'kimi-k3' })
    expect(resolveModelSelection(services, undefined)).toEqual({ serviceId: 'svc-a', modelId: 'kimi-k3' })
  })

  it('is undefined without services', () => {
    expect(resolveModelSelection([], { serviceId: 'svc-a', modelId: 'kimi-k3' })).toBeUndefined()
  })
})

describe('buildModelChoices', () => {
  it('groups by service with a label when several are set up', () => {
    expect(buildModelChoices(services)).toEqual([
      [
        { type: 'label', label: 'Work' },
        { label: 'glm-5.3', description: 'glm-5.3', value: 'svc-a:glm-5.3', serviceId: 'svc-a', modelId: 'glm-5.3' },
        { label: 'kimi-k3', description: 'kimi-k3', value: 'svc-a:kimi-k3', serviceId: 'svc-a', modelId: 'kimi-k3' }
      ],
      [
        { type: 'label', label: 'Local' },
        { label: 'qwen3:8b', description: 'qwen3:8b', value: 'svc-b:qwen3:8b', serviceId: 'svc-b', modelId: 'qwen3:8b' }
      ]
    ])
  })

  it('keeps a catalog name as the label and the model id as the description', () => {
    const named: AiServiceModels[] = [{
      service: { id: 'svc-a', name: 'OpenCode' },
      defaultModel: 'deepseek-v4.1-flash',
      models: [{ id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }]
    }]

    expect(buildModelChoices(named)).toEqual([[
      { label: 'DeepSeek V4.1 Flash', description: 'deepseek-v4.1-flash', value: 'svc-a:deepseek-v4.1-flash', serviceId: 'svc-a', modelId: 'deepseek-v4.1-flash' }
    ]])
  })

  it('omits the group label for a single service', () => {
    expect(buildModelChoices([services[0]!])).toEqual([[
      { label: 'glm-5.3', description: 'glm-5.3', value: 'svc-a:glm-5.3', serviceId: 'svc-a', modelId: 'glm-5.3' },
      { label: 'kimi-k3', description: 'kimi-k3', value: 'svc-a:kimi-k3', serviceId: 'svc-a', modelId: 'kimi-k3' }
    ]])
  })

  it('skips a service that lists no models', () => {
    expect(buildModelChoices([{ service: { id: 'svc-c', name: 'Down' }, defaultModel: '', models: [], error: 'nope' }])).toEqual([])
  })
})
