import { rebuildCalendarSearch } from '../utils/calendar-sync'

// An existing cache built before full-text search existed has objects but no
// search rows. Building them happens once, on whichever worker wins the lock.
export default defineNitroPlugin(() => {
  rebuildCalendarSearch()
    .then((indexed) => {
      if (indexed) {
        console.info(`[calendar:search] Indexed ${indexed} cached events`)
      }
    })
    .catch(error => console.warn('[calendar:search] Backfill failed:', error))
})
