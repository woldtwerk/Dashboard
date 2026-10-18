// Local Laya decision engine for the automation layer.
// The `laya-serve` container (see .ddev/laya) answers the typed decisions a rule
// asks; nothing leaves the machine. Without `laya.url`, no engine is registered
// and AI rules never match.
export default defineNuxtConfig({
  runtimeConfig: {
    laya: {
      // NUXT_LAYA_URL — base URL of laya-serve, e.g. http://laya:8000 in DDEV
      url: '',
      // NUXT_LAYA_API_KEY — the bearer the server requires (LAYA_API_KEY), from .ddev/.env.web
      apiKey: '',
      // NUXT_LAYA_TIMEOUT_MS — per-request timeout; a CPU forward pass can take seconds
      timeoutMs: 15000,
      // NUXT_LAYA_BATCH_SIZE — states per request; laya-serve caps a batch at 64
      batchSize: 64,
      // NUXT_LAYA_MAX_LEN — per-state token budget; the server caps it at LAYA_MAX_TOKEN_BUDGET (8192)
      maxLen: 2048,
      // NUXT_LAYA_LANG — optional `lang_guess` hint, e.g. `de`; empty lets Laya route by content
      lang: ''
    }
  }
})
