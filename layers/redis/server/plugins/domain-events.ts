import { useRuntimeConfig } from 'nuxt/server'
import { createRedisEventBus } from '../utils/redis-event-bus'

// Without an adapter the core falls back to an in-process bus, which only
// reaches SSE clients on this worker; Redis carries events across the cluster.
export default defineNitroPlugin((nitroApp) => {
  const { redis } = useRuntimeConfig()

  if (!redis.url) {
    return
  }

  const bus = createRedisEventBus(redis.url)
  registerDomainEventBus(() => bus)

  nitroApp.hooks.hook('close', async () => {
    await bus.close()
  })
})
