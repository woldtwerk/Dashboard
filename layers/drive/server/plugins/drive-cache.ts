import { removeCachedDriveService } from '../utils/drive-sync'

// Drop cached entries, folder state and sync state of removed services. The
// saved file records go with the service through the foreign key cascade in the
// main database.
export default defineNitroPlugin(() => {
  serviceHooks.hook('removed', async ({ id, domain }) => {
    if (domain === 'drive') {
      await removeCachedDriveService(id)
    }
  })
})
