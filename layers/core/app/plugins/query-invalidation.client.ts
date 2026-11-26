import { useQueryCache } from '@pinia/colada'
import { matchingInvalidations, mergeInvalidations } from '../utils/query-invalidation'
import type { QueryInvalidation } from '../utils/query-invalidation'

/** Quiet time a burst needs before its invalidations are flushed */
const FLUSH_AFTER_MS = 300
/** A burst that never goes quiet still flushes after this long */
const MAX_WAIT_MS = 2000

/**
 * The one subscription that turns domain events into query-cache
 * invalidations. Layers register what their domain's events affect; core
 * knows no domain. Events arrive in bursts (a sync changes many folders), so
 * their invalidations are collected and flushed once, after the burst.
 */
export default defineNuxtPlugin({
  name: 'query-invalidation',
  dependsOn: ['pinia', 'Pinia Colada'],
  setup() {
    const queryCache = useQueryCache()
    let pending: QueryInvalidation[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    let burstStartedAt = 0

    function flush() {
      const invalidations = mergeInvalidations(pending)
      pending = []
      burstStartedAt = 0
      timer = undefined
      for (const invalidation of invalidations) {
        void queryCache.invalidateQueries({
          key: invalidation.key,
          predicate: invalidation.predicate ? entry => invalidation.predicate!(entry.key) : undefined
        }).catch(() => {})
      }
    }

    function queue(event?: DomainEvent) {
      const additions = matchingInvalidations(event)
      if (!additions.length) {
        return
      }
      pending.push(...additions)
      const now = Date.now()
      burstStartedAt ||= now
      clearTimeout(timer)
      // Trailing debounce, capped so a continuous burst cannot postpone the flush forever
      timer = setTimeout(flush, Math.min(FLUSH_AFTER_MS, Math.max(0, burstStartedAt + MAX_WAIT_MS - now)))
    }

    useDomainEvents({}, queue, { onReconnect: () => queue() })
  }
})
