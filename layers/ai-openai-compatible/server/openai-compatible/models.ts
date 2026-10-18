import type { SetupValues } from '../../../core/shared/types/setup'
import type { AiModelInfo } from '../../../ai/shared/types/ai'
import { toOpenAICompatibleSettings } from './provider'

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

  const response = await fetch(`${settings.baseUrl}/models`, {
    headers,
    signal: AbortSignal.timeout(MODELS_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`The model list could not be loaded (HTTP ${response.status})`)
  }

  return toAiModelInfos(await response.json())
}
