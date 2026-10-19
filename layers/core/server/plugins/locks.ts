import { releaseHeldLocks } from '../utils/locks'

// A sync running in this worker dies with it on shutdown; without this its
// lease would stay behind until the TTL runs out and report the sync as running.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', async () => {
    await releaseHeldLocks()
  })
})
