import { isCacheReady } from '@pinia/colada-plugin-cache-persister'

/**
 * Nuxt waits for plugin setups before mounting, so the first page setup already
 * sees restored entries. The IndexedDB read starts before the SSR payload is
 * hydrated and resolves after it, so hydration itself is not delayed.
 */
export default defineNuxtPlugin({
  name: 'query-cache-restore',
  dependsOn: ['Pinia Colada'],
  async setup() {
    await isCacheReady()
  }
})
