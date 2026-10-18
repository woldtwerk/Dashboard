import type { SetupValues } from '../../../core/shared/types/setup'
import type { AiModelInfo } from '../../../ai/shared/types/ai'
import { toOpenAICompatibleSettings } from './provider'
import { catalogProviderKey, loadOpenCodeCatalog, toOpenCodeModels } from './catalog'

const MODELS_TIMEOUT_MS = 10_000

/**
 * Maps an OpenAI `/models` body (`{ data: [{ id }] }`) to a model list,
 * sorted by id and without duplicates.
 */
export function toAiModelInfos(payload: unknown): AiModelInfo[] {
  const data = (payload as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    return []
  }

  const ids = data
    .map(entry => (entry as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map(id => id.trim())

  return [...new Set(ids)]
    .sort((a, b) => a.localeCompare(b))
    .map(id => ({ id, label: id }))
}

/**
 * The `/models` URL of an OpenAI-compatible base. OpenCode serves the shared
 * list one level above its per-SDK bases: `.../go/openai/v1` → `.../go/v1/models`.
 */
export function modelsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const openaiSuffix = '/openai/v1'
  return base.endsWith(openaiSuffix)
    ? `${base.slice(0, -openaiSuffix.length)}/v1/models`
    : `${base}/models`
}

/** Lists a service's models from its OpenAI-compatible `/models` endpoint. */
export async function listOpenAICompatibleModels(values: SetupValues): Promise<AiModelInfo[]> {
  const settings = toOpenAICompatibleSettings(values)
  if (!settings.baseUrl) {
    throw new Error('The API base URL is not set')
  }

  const headers: Record<string, string> = { 'User-Agent': 'allmight-dashboard' }
  if (settings.apiKey) {
    headers.authorization = `Bearer ${settings.apiKey}`
  }

  const response = await fetch(modelsUrl(settings.baseUrl), {
    headers,
    signal: AbortSignal.timeout(MODELS_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`The model list could not be loaded (HTTP ${response.status})`)
  }

  return toAiModelInfos(await response.json())
}

/**
 * The models of an OpenCode service: what the endpoint serves, described by the
 * models.dev catalog. Only tool-calling models the catalog knows are offered,
 * because the assistant needs tools and a stranded id would fail every call.
 */
export async function listOpenCodeModels(values: SetupValues): Promise<AiModelInfo[]> {
  const settings = toOpenAICompatibleSettings(values)
  const [listed, catalog] = await Promise.all([
    listOpenAICompatibleModels(values),
    loadOpenCodeCatalog()
  ])

  const meta = toOpenCodeModels(catalog, catalogProviderKey(settings.baseUrl), settings.baseUrl)
  return listed
    .flatMap((model) => {
      const entry = meta.get(model.id)
      return entry?.toolCall ? [{ id: model.id, label: entry.name }] : []
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}
