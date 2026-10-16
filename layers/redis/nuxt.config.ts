// Redis for state that all cluster workers share (caches, rate limits, ...).
// Available as `useStorage('redis')` once NUXT_REDIS_URL is set; without it nothing is mounted.
// Note: the DDEV Redis evicts keys under memory pressure (allkeys-lfu), so treat it as a cache.
export default defineNuxtConfig({
  runtimeConfig: {
    redis: {
      // NUXT_REDIS_URL, e.g. redis://redis:6379 in DDEV
      url: ''
    }
  }
})
