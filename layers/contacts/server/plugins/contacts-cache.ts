import { removeCachedContactsService } from '../utils/contacts-sync'

// Drop cached address books, cards and sync state of removed services.
export default defineNitroPlugin(() => {
  serviceHooks.hook('removed', async ({ id, domain }) => {
    if (domain === 'contacts') {
      await removeCachedContactsService(id)
    }
  })
})
