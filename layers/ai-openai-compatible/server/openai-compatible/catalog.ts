import { modelsStorage } from '../../../ai/server/utils/ai'

/**
 * The models.dev catalog describes every OpenCode model: which SDK speaks to it,
 * at which endpoint, and whether it can call tools. The catalog is published as
 * one JSON document, so it is fetched once and cached for a few hours.
 */

const CATALOG_URL = 'https://models.dev/api.json'
const CATALOG_TIMEOUT_MS = 10_000
const CATALOG_CACHE_KEY = 'ai:catalog:models.dev'
const CATALOG_CACHE_TTL_MS = 6 * 60 * 60 * 1000

/** The wire protocol a model is served with; each one has its own base URL. */
export type OpenCodeSdk = 'openai-compatible' | 'openai-responses' | 'anthropic' | 'google'

export interface OpenCodeModelMeta {
  id: string
  name: string
  sdk: OpenCodeSdk
  api: string
  toolCall: boolean
}

// The catalog names the SDK as its provider package; an unknown one (e.g. mistral) is not served
const SDK_BY_PACKAGE: Record<string, OpenCodeSdk> = {
  '@ai-sdk/openai-compatible': 'openai-compatible',
  '@ai-sdk/openai': 'openai-responses',
  '@ai-sdk/anthropic': 'anthropic',
  '@ai-sdk/google': 'google'
}

/** The models.dev provider an OpenCode base URL belongs to. */
export function catalogProviderKey(baseUrl: string): 'opencode-go' | 'opencode' {
  return baseUrl.includes('/inference/go/') ? 'opencode-go' : 'opencode'
}

/**
 * The provider's models from the models.dev catalog, keyed by model id. A model
 * without a provider package speaks chat completions, as does an explicit
 * `@ai-sdk/openai-compatible`; models of an SDK we cannot build are left out.
 */
export function toOpenCodeModels(catalog: unknown, providerKey: string, fallbackApi: string): Map<string, OpenCodeModelMeta> {
  const models = new Map<string, OpenCodeModelMeta>()
  const provider = (catalog as { [key: string]: { models?: unknown } } | null)?.[providerKey]
  const entries = provider?.models
  if (!entries || typeof entries !== 'object') {
    return models
  }

  for (const [id, value] of Object.entries(entries)) {
    const entry = value as { name?: unknown, tool_call?: unknown, provider?: { npm?: unknown, api?: unknown } } | null
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const npm = entry.provider?.npm
    const sdk = npm === undefined || npm === null ? 'openai-compatible' : SDK_BY_PACKAGE[String(npm)]
    if (!sdk) {
      continue
    }

    models.set(id, {
      id,
      name: typeof entry.name === 'string' && entry.name ? entry.name : id,
      sdk,
      api: typeof entry.provider?.api === 'string' && entry.provider.api ? entry.provider.api : fallbackApi,
      toolCall: entry.tool_call === true
    })
  }

  return models
}

/** The raw models.dev document, cached in Nitro storage for a few hours. */
export async function loadOpenCodeCatalog(): Promise<unknown> {
  const storage = modelsStorage()
  const cached = await storage.getItem<unknown>(CATALOG_CACHE_KEY)
  if (cached) {
    return cached
  }

  const response = await fetch(CATALOG_URL, {
    headers: { 'User-Agent': 'allmight-dashboard' },
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`The model catalog could not be loaded (HTTP ${response.status})`)
  }

  const catalog = await response.json()
  await storage.setItem(CATALOG_CACHE_KEY, catalog, { ttl: CATALOG_CACHE_TTL_MS / 1000 })
  return catalog
}
