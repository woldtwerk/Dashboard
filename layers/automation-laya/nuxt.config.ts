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
      // NUXT_LAYA_TIMEOUT_MS — batch timeout; a batch carries many states and the
      // first call after a cold start also warms the model, so it gets the longer default
      timeoutMs: 60000,
      // NUXT_LAYA_SINGLE_TIMEOUT_MS — timeout of one non-batched call
      singleTimeoutMs: 30000,
      // NUXT_LAYA_BATCH_SIZE — states per request; laya-serve caps a batch at 64
      batchSize: 64,
      // NUXT_LAYA_MAX_LEN — per-state token budget. The multilingual checkpoint's
      // own limit is 1024; a decision reads the subject and the top of the body, so
      // 512 keeps a 10-item batch near a few seconds instead of tens of seconds.
      maxLen: 512,
      // NUXT_LAYA_LANG — optional `lang_guess` hint, e.g. `de`; empty lets Laya route by content
      lang: ''
    }
  }
})
