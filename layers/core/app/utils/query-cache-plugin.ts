import type { PiniaColadaPlugin } from '@pinia/colada'
import { createPersistedQueryCachePlugin } from './query-cache-storage'

/**
 * The Pinia Colada plugin the options install on the client. The session is
 * captured once here, so a later login or logout is reflected without a reload.
 */
export const persistedQueryCachePlugin: PiniaColadaPlugin = (context) => {
  const { user } = useUserSession()
  createPersistedQueryCachePlugin(() => user.value?.id)(context)
}
