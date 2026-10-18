import { randomUUID } from 'node:crypto'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createError } from 'nuxt/server'
import type { AiModel, AiModelOptions } from '../../../ai/server/utils/ai'
import type { SetupValues } from '../../../core/shared/types/setup'
import { sameOrigin } from '../../../core/server/utils/url'
import { catalogProviderKey, loadOpenCodeCatalog, toOpenCodeModels } from './catalog'
import type { OpenCodeModelMeta, OpenCodeSdk } from './catalog'

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
export async function createOpenCodeModel(values: SetupValues, { session }: AiModelOptions): Promise<AiModel> {
  const settings = toOpenAICompatibleSettings(values)
  const { sdk, api } = await resolveOpenCodeModel(loadOpenCodeCatalog, settings.baseUrl, settings.model)

  const headers: Record<string, string> = {
    'x-opencode-session': session ?? randomUUID(),
    'User-Agent': 'allmight-dashboard'
  }

  switch (sdk) {
    case 'openai-responses': {
      const provider = createOpenAI({ baseURL: api, apiKey: settings.apiKey, headers })
      return { model: provider.responses(settings.model), headers }
    }
    case 'anthropic': {
      const provider = createAnthropic({ baseURL: api, apiKey: settings.apiKey, headers })
      return { model: provider(settings.model), headers }
    }
    case 'google': {
      const provider = createGoogleGenerativeAI({ baseURL: api, apiKey: settings.apiKey, headers })
      return { model: provider(settings.model), headers }
    }
    default:
      return createOpenAICompatibleModel(settings, 'opencode', headers)
  }
}

/**
 * The SDK and endpoint of a model, read from the models.dev catalog. A catalog
 * that cannot be loaded is not fatal: without it every model is tried as a chat
 * completions model on the configured base URL, so an outage does not break
 * chat or the setup connection test.
 */
export async function resolveOpenCodeModel(loadCatalog: () => Promise<unknown>, baseUrl: string, model: string): Promise<{ sdk: OpenCodeSdk, api: string }> {
  let catalog: unknown = {}
  try {
    catalog = await loadCatalog()
  } catch {
    // The empty catalog leaves only the chat completions fallback below
  }

  return selectOpenCodeSdk(toOpenCodeModels(catalog, catalogProviderKey(baseUrl), baseUrl).get(model), baseUrl)
}

/**
 * Which SDK speaks to a model, and at which endpoint. The endpoint comes from
 * the catalog, so it is only used when it sits on the configured host — the
 * stored key must never be sent anywhere else. A model the catalog does not
 * know is tried as a chat completions model.
 */
export function selectOpenCodeSdk(meta: OpenCodeModelMeta | undefined, baseUrl: string): { sdk: OpenCodeSdk, api: string } {
  if (!meta || meta.sdk === 'openai-compatible') {
    return { sdk: 'openai-compatible', api: baseUrl }
  }
  if (!sameOrigin(meta.api, baseUrl)) {
    throw createError({ status: 502, statusText: 'Model endpoint is not on the configured host' })
  }
  return { sdk: meta.sdk, api: meta.api }
}

export function createGenericModel(values: SetupValues): AiModel {
  return createOpenAICompatibleModel(toOpenAICompatibleSettings(values), 'openai-compatible')
}
