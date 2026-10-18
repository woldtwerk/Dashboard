import { flushLogs } from '../utils/service-logger'

// The queue is a per-worker write buffer; the last flush must not be lost when
// Nitro shuts down.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', async () => {
    await flushLogs()
  })
})
