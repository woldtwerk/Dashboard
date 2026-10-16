import { useRuntimeConfig } from 'nuxt/server'
import { createMeilisearchMailIndex } from '../meilisearch'

export default defineNitroPlugin(() => {
  const { meilisearch } = useRuntimeConfig()

  if (meilisearch.host) {
    registerMailSearchIndex(() => createMeilisearchMailIndex({
      ...meilisearch,
      semanticRatio: Number(meilisearch.semanticRatio),
      rankingScoreThreshold: Number(meilisearch.rankingScoreThreshold)
    }))
  }
})
