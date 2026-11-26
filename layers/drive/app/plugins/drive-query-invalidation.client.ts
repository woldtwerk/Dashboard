import { defineQueryInvalidation } from '#layers/core/app/utils/query-invalidation'
import { driveRefreshFor } from '../utils/drive-events'

/**
 * A changed folder's listing is stale. The core plugin turns this rule into
 * cache invalidations; drive keeps knowing which folders its events touch.
 */
export default defineNuxtPlugin(() => {
  defineQueryInvalidation({
    filter: { domains: ['drive'] },
    keys: event => event ? [['drive', event.service]] : [['drive']],
    predicate: (event, entryKey) => driveRefreshFor(event, String(entryKey[2]))
  })
})
