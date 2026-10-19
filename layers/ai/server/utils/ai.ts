import { createHash } from 'node:crypto'
import type { LanguageModel } from 'ai'
import { createError } from 'nuxt/server'
import { z } from 'zod'
import { isAiModelAllowed } from '../../shared/ai-model'
import type { AiModelInfo, AiServiceModels } from '../../shared/types/ai'
import type { SetupValues } from '../../../core/shared/types/setup'
import { safeErrorMessage } from '../../../core/server/utils/errors'
import { sharedStorage } from '../../../core/server/utils/shared-storage'

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
export type AiProviderFactory = (values: SetupValues, options: AiModelOptions) => AiModel | Promise<AiModel>

export interface AiProvider {
  create: AiProviderFactory
  /** Lists the service's models, e.g. from the provider's `/models`; optional */
  listModels?: (values: SetupValues) => Promise<AiModelInfo[]>
}

const providers = new Map<string, AiProvider>()

export function registerAiProvider(connector: string, factory: AiProviderFactory, options: { listModels?: AiProvider['listModels'] } = {}) {
  providers.set(connector, { create: factory, listModels: options.listModels })
}

export function getAiProvider(connector: string): AiProvider | undefined {
  return providers.get(connector)
}

export async function createAiModel(connector: string, values: SetupValues, options: AiModelOptions = {}): Promise<AiModel> {
  const provider = providers.get(connector)
  if (!provider) {
    throw createError({ status: 503, statusText: `AI provider "${connector}" is not available` })
  }
  return await provider.create(values, options)
}

/** Whether a string contains ASCII control characters */
function hasControlCharacters(value: string): boolean {
  return [...value].some(char => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)
}

/** A model id coming from the client: bounded and free of control characters */
export const aiModelIdSchema = z.string().trim().min(1).max(200)
  .refine(value => !hasControlCharacters(value), 'The model id contains control characters')

// --- Model lists ----------------------------------------------------------

const MODELS_CACHE_TTL_MS = 10 * 60 * 1000

interface CachedModels {
  models: AiModelInfo[]
  expiresAt: number
}

// Redis when mounted (shared by all cluster workers), else the default Nitro storage
export function modelsStorage() {
  return sharedStorage()
}

// Keyed by service and a hash of its base URL, so neither the API key nor the URL lands in the cache
function modelsCacheKey(service: { id: string, values: SetupValues }): string {
  const hash = createHash('sha256').update(String(service.values.baseUrl ?? '')).digest('hex').slice(0, 16)
  return `ai:models:v2:${service.id}:${hash}`
}

async function readCachedModels(service: { id: string, values: SetupValues }): Promise<AiModelInfo[] | undefined> {
  const cached = await modelsStorage().getItem<CachedModels>(modelsCacheKey(service))
  if (cached && Array.isArray(cached.models) && typeof cached.expiresAt === 'number' && cached.expiresAt > Date.now()) {
    return cached.models
  }
  return undefined
}

async function writeCachedModels(service: { id: string, values: SetupValues }, models: AiModelInfo[]): Promise<void> {
  const value: CachedModels = { models, expiresAt: Date.now() + MODELS_CACHE_TTL_MS }
  await modelsStorage().setItem(modelsCacheKey(service), value, { ttl: MODELS_CACHE_TTL_MS / 1000 })
}

/** The service's models from the provider, cached for a few minutes */
async function listedModels(service: { id: string, connector: string, values: SetupValues }): Promise<AiModelInfo[]> {
  const listModels = getAiProvider(service.connector)?.listModels
  if (!listModels) {
    return []
  }
  const cached = await readCachedModels(service)
  if (cached) {
    return cached
  }
  const models = await listModels(service.values)
  await writeCachedModels(service, models)
  return models
}

/** The configured model, added when the provider did not list it */
function withDefaultModel(models: AiModelInfo[], defaultModel: string): AiModelInfo[] {
  return defaultModel && !models.some(model => model.id === defaultModel)
    ? [{ id: defaultModel, label: defaultModel }, ...models]
    : models
}

/** The models of one AI service; a provider that lists none falls back to the configured model */
export async function aiServiceModels(service: { id: string, connector: string, name: string, values: SetupValues }): Promise<AiServiceModels> {
  const info = { id: service.id, name: service.name }
  const defaultModel = String(service.values.model ?? '')

  try {
    const models = await listedModels(service)
    return { service: info, defaultModel, models: withDefaultModel(models, defaultModel) }
  } catch (error) {
    return { service: info, defaultModel, models: withDefaultModel([], defaultModel), error: safeErrorMessage(error, 'The model list could not be loaded') }
  }
}

/** Models of every configured AI service; a failing service is reported in its entry, not thrown */
export async function listAiServiceModels(): Promise<AiServiceModels[]> {
  const services = await listServices('ai')

  return Promise.all(services.map(async (info) => {
    try {
      return await aiServiceModels(await getService(info.id, 'ai'))
    } catch (error) {
      return { service: { id: info.id, name: info.name }, defaultModel: '', models: [], error: safeErrorMessage(error, 'The model list could not be loaded') }
    }
  }))
}

// --- The model of a request -----------------------------------------------

export interface UseAiModelOptions extends AiModelOptions {
  /** A configured service id; without it, the first configured one */
  service?: string
  /** A model id listed by the service; defaults to its configured model */
  model?: string
}

export async function useAiModel(options: UseAiModelOptions = {}): Promise<AiModel> {
  const { service: serviceId, model: modelId, ...modelOptions } = options
  const services = await listServices('ai')
  const id = serviceId ?? services[0]?.id

  if (!id) {
    throw createError({ status: 503, statusText: 'No AI service set up. Add one under Services.' })
  }
  if (serviceId && !services.some(service => service.id === serviceId)) {
    throw createError({ status: 400, statusText: 'The selected AI service does not exist' })
  }

  const service = await getService(id, 'ai')
  let values = service.values

  if (modelId !== undefined) {
    const parsed = aiModelIdSchema.safeParse(modelId)
    if (!parsed.success) {
      throw createError({ status: 400, statusText: parsed.error.issues[0]?.message ?? 'Invalid model id' })
    }
    const { defaultModel, models } = await aiServiceModels(service)
    if (!isAiModelAllowed(parsed.data, defaultModel, models)) {
      throw createError({ status: 400, statusText: `The model "${parsed.data}" is not available for this service` })
    }
    values = { ...values, model: parsed.data }
  }

  return await createAiModel(service.connector, values, modelOptions)
}
