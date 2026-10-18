import { createLayaDecisionEngine } from '../laya/engine'
import { createLayaClient } from '../laya/client'

// Registers the local Laya engine when `NUXT_LAYA_URL` is set; without it the
// automation layer has no engine and AI rules never match.
export default defineNitroPlugin(() => {
  const { laya } = useRuntimeConfig()
  if (!laya.url) {
    return
  }

  const client = createLayaClient({
    url: laya.url,
    apiKey: laya.apiKey,
    timeoutMs: laya.timeoutMs,
    batchSize: laya.batchSize,
    request: {
      maxLen: laya.maxLen,
      lang: laya.lang || undefined
    }
  })

  registerDecisionEngine('laya', () => createLayaDecisionEngine(client))
})
