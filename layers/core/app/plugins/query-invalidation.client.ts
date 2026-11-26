import { useQueryCache } from '@pinia/colada'
import { matchingInvalidations } from '../utils/query-invalidation'

/**
 * The one subscription that turns domain events into query-cache
 * invalidations. Layers register what their domain's events affect; core
 * knows no domain.
 */
export default defineNuxtPlugin({
  name: 'query-invalidation',
  dependsOn: ['pinia', 'Pinia Colada'],
  setup() {
    const queryCache = useQueryCache()

    function invalidate(event?: DomainEvent) {
      for (const invalidation of matchingInvalidations(event)) {
        void queryCache.invalidateQueries({
          key: invalidation.key,
          predicate: invalidation.predicate ? entry => invalidation.predicate!(entry.key) : undefined
        })
      }
    }

    useDomainEvents({}, invalidate, { onReconnect: () => invalidate() })
  }
})
