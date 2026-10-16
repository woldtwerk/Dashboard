import { defineNuxtModule } from '@nuxt/kit'

// Adds a Nuxt DevTools tab that embeds the RedisInsight UI (served by DDEV).
// The frame works because .ddev/traefik/config/allmight-noframe.yaml strips X-Frame-Options.
export default defineNuxtModule({
  meta: {
    name: 'redis-insight-devtools'
  },
  setup(_options, nuxt) {
    const ddevHostname = process.env.DDEV_HOSTNAME
    if (!nuxt.options.dev || !ddevHostname) {
      return
    }

    nuxt.hook('devtools:customTabs', (tabs) => {
      tabs.push({
        name: 'redis-insight',
        title: 'RedisInsight',
        icon: 'simple-icons:redis',
        view: {
          type: 'iframe',
          src: `https://redis.${ddevHostname}`
        }
      })
    })
  }
})
