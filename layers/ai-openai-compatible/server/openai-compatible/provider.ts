import { randomUUID } from 'node:crypto'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { AiModel, AiModelOptions } from '../../../ai/server/utils/ai'
import type { SetupValues } from '../../../core/shared/types/setup'

export interface OpenAICompatibleSettings {
  baseUrl: string
  apiKey?: string
  model: string
  structuredOutputs: boolean
}

export function toOpenAICompatibleSettings(values: SetupValues): OpenAICompatibleSettings {
  return {
    baseUrl: String(values.baseUrl ?? '').replace(/\/+$/, ''),
    apiKey: values.apiKey ? String(values.apiKey) : undefined,
    model: String(values.model ?? ''),
    structuredOutputs: values.structuredOutputs === true
  }
}

export function createOpenAICompatibleModel(settings: OpenAICompatibleSettings, name: string, headers?: Record<string, string>): AiModel {
  const provider = createOpenAICompatible({
    name,
    baseURL: settings.baseUrl,
    apiKey: settings.apiKey,
    headers: { 'User-Agent': 'allmight-dashboard' },
    supportsStructuredOutputs: settings.structuredOutputs
  })

  return { model: provider(settings.model), headers }
}

/** OpenCode rejects requests without a session id; one per conversation */
export function createOpenCodeModel(values: SetupValues, { session }: AiModelOptions): AiModel {
  return createOpenAICompatibleModel(toOpenAICompatibleSettings(values), 'opencode', {
    'x-opencode-session': session ?? randomUUID()
  })
}

export function createGenericModel(values: SetupValues): AiModel {
  return createOpenAICompatibleModel(toOpenAICompatibleSettings(values), 'openai-compatible')
}
