import { useRuntimeConfig } from 'nuxt/server'
import { createMeilisearchMailIndex } from '../meilisearch'

/** NUXT_MEILISEARCH_TYPO_DISABLE_ON_ATTRIBUTES is a comma separated list */
const toList = (value: unknown) => String(value ?? '').split(',').map(item => item.trim()).filter(Boolean)

export default defineNitroPlugin(() => {
  const { meilisearch } = useRuntimeConfig()

  if (meilisearch.host) {
    registerMailSearchIndex(() => createMeilisearchMailIndex({
      host: meilisearch.host,
      apiKey: meilisearch.apiKey,
      index: meilisearch.index,
      embedderModel: meilisearch.embedderModel,
      semanticRatio: Number(meilisearch.semanticRatio),
      rankingScoreThreshold: Number(meilisearch.rankingScoreThreshold),
      typoTolerance: String(meilisearch.typoTolerance) === 'true',
      typoOneTypo: Number(meilisearch.typoOneTypo),
      typoTwoTypos: Number(meilisearch.typoTwoTypos),
      typoDisableOnNumbers: String(meilisearch.typoDisableOnNumbers) === 'true',
      typoDisableOnAttributes: toList(meilisearch.typoDisableOnAttributes)
    }))
  }
})
