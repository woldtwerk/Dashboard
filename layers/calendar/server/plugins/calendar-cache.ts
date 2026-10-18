import { removeCachedService } from '../utils/calendar-sync'

// Drop cached calendars, events and sync state of removed services. Preferences
// go with the service through the foreign key cascade in the main database.
export default defineNitroPlugin(() => {
  serviceHooks.hook('removed', async ({ id, domain }) => {
    if (domain === 'calendar') {
      await removeCachedService(id)
    }
  })
})
