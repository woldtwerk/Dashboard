import { useRuntimeConfig } from 'nuxt/server'
import redisDriver from 'unstorage/drivers/redis'

export default defineNitroPlugin(() => {
  const { redis } = useRuntimeConfig()

  if (redis.url) {
    useStorage().mount('redis', redisDriver({ url: redis.url, base: 'allmight' }))
  }
})
