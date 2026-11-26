import { useDebounceFn } from '@vueuse/core'
import { defineQueryInvalidation } from '#layers/core/app/utils/query-invalidation'
import { mailQueryKeysFor } from '../utils/mail-events'
import { MAIL_FOLDERS_KEY, refetchMailFolders } from '../composables/useMailFolders'

/**
 * A mail change makes its cached data stale. Core turns this rule into cache
 * invalidations; mail keeps knowing which keys its events touch. A reconnect
 * may have missed events, so everything mail is refreshed.
 */
export default defineNuxtPlugin(() => {
  defineQueryInvalidation({
    filter: { domains: ['mail'] },
    keys: event => event ? mailQueryKeysFor(event) : [['mail']]
  })

  const queryCache = useQueryCache()
  const requestFetch = useRequestFetch()

  /**
   * Folder counts are not invalidated by the rule above: they need a read that
   * bypasses the server's shared cache. A sync sends its changes in bursts, so
   * one refetch after the burst is enough — and only when a folders query is
   * actually cached (nobody showing folders, nothing to refresh).
   */
  const refreshFolders = useDebounceFn(() => {
    if (!queryCache.get(MAIL_FOLDERS_KEY)) {
      return
    }
    void refetchMailFolders(queryCache, requestFetch)
  }, 300)

  useDomainEvents({ domains: ['mail'] }, (event) => {
    if (event.type === 'changed') {
      refreshFolders()
    }
  }, {
    onReconnect: () => refreshFolders()
  })
})
