import type { LanguageModel } from 'ai'
import { createError } from 'nuxt/server'
import type { SetupValues } from '../../../core/shared/types/setup'

export interface AiModel {
  model: LanguageModel
  /** Per-call headers the provider needs, pass them to generateText/streamText */
  headers?: Record<string, string>
}

export interface AiModelOptions {
  /** Groups calls of one conversation, for providers that track sessions */
  session?: string
}

/** Creates a model from the settings of one AI service */
export type AiProviderFactory = (values: SetupValues, options: AiModelOptions) => AiModel

const providers = new Map<string, AiProviderFactory>()

export function registerAiProvider(connector: string, factory: AiProviderFactory) {
  providers.set(connector, factory)
}

export function createAiModel(connector: string, values: SetupValues, options: AiModelOptions = {}): AiModel {
  const factory = providers.get(connector)
  if (!factory) {
    throw createError({ status: 503, statusText: `AI provider "${connector}" is not available` })
  }
  return factory(values, options)
}

/** The model of an AI service; without `service`, the first configured one */
export async function useAiModel(options: AiModelOptions & { service?: string } = {}): Promise<AiModel> {
  const id = options.service ?? (await listServices('ai'))[0]?.id
  if (!id) {
    throw createError({ status: 503, statusText: 'No AI service set up. Add one under Services.' })
  }

  const service = await getService(id, 'ai')
  return createAiModel(service.connector, service.values, options)
}
