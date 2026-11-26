import type { PiniaColadaOptions } from '@pinia/colada'

// Global query defaults: the `PiniaColada` plugin reads them from `queryOptions`.
export default {
  queryOptions: {
    staleTime: 30_000,
    gcTime: 600_000
  }
} satisfies PiniaColadaOptions
