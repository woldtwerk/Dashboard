import type { DecisionAnswer, DecisionQuestion } from '../../../automation/shared/types/automation'
import type { DecisionEngine } from '../../../automation/server/utils/decision-engine'
import type { AutomationDecisionSettings } from '../../shared/settings'
import type { LayaClient } from './client'
import { createLayaClient } from './client'
import { systemOneBaseUrl } from './systemone-url'

/**
 * The primary decision engine. Both providers speak the same `/v1/systemone`
 * protocol, so one engine resolves its provider from the settings on every call.
 */
export function createSystemOneEngine(): DecisionEngine {
  async function available(): Promise<boolean> {
    const settings = await getSettings<AutomationDecisionSettings>('automation')
    if (settings.provider === 'opencode') {
      return Boolean(settings.service && settings.model)
    }
    return Boolean(useRuntimeConfig().laya.url)
  }

  async function client(): Promise<LayaClient> {
    const settings = await getSettings<AutomationDecisionSettings>('automation')
    return settings.provider === 'opencode' ? openCodeClient(settings) : localClient()
  }

  return {
    available,
    async decide(state: string, questions: Record<string, DecisionQuestion>): Promise<Record<string, DecisionAnswer>> {
      return (await client()).systemOne(state, questions)
    },
    async decideBatch(states: string[], questions: Record<string, DecisionQuestion>): Promise<Array<Record<string, DecisionAnswer>>> {
      return (await client()).systemOneBatch(states, questions)
    }
  }
}

function localClient(): LayaClient {
  const { laya } = useRuntimeConfig()
  if (!laya.url) {
    // A plain Error, not createError: a misconfiguration must not look retryable
    throw new Error('No Laya server is configured. Set NUXT_LAYA_URL or switch to OpenCode in Settings → Automation.')
  }

  return createLayaClient({
    url: laya.url,
    apiKey: laya.apiKey,
    batchTimeoutMs: laya.timeoutMs,
    singleTimeoutMs: laya.singleTimeoutMs,
    batchSize: laya.batchSize,
    request: {
      maxLen: laya.maxLen,
      lang: laya.lang || undefined
    }
  })
}

async function openCodeClient(settings: AutomationDecisionSettings): Promise<LayaClient> {
  if (!settings.service || !settings.model) {
    throw new Error('Choose an OpenCode service and a decision model in Settings → Automation.')
  }

  const service = await getService(settings.service, 'ai')
  if (service.connector !== 'opencode') {
    throw new Error('The service chosen in Settings → Automation is not an OpenCode service.')
  }

  const { baseUrl, apiKey } = service.values
  if (typeof baseUrl !== 'string' || typeof apiKey !== 'string') {
    throw new Error('The OpenCode service has no base URL or key. Set it up again under Services.')
  }

  return createLayaClient({
    url: systemOneBaseUrl(baseUrl),
    apiKey,
    request: { model: settings.model },
    batch: false,
    label: 'OpenCode'
  })
}
