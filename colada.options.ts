import type { PiniaColadaOptions } from '@pinia/colada'
import { persistedQueryCachePlugin } from './layers/core/app/utils/query-cache-plugin'

// Global query defaults: the `PiniaColada` plugin reads them from `queryOptions`.
export default {
  queryOptions: {
    staleTime: 30_000,
    gcTime: 600_000
  },
  // IndexedDB and the session live in the browser; the server renders without them.
  plugins: import.meta.client ? [persistedQueryCachePlugin] : []
} satisfies PiniaColadaOptions
