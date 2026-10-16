// Meilisearch as mail search index: full text plus semantic (hybrid) search.
// Embeddings are computed inside Meilisearch by a local model, so mail text never leaves the machine for that.
// Without a host, the mail layer keeps searching through the mail provider.
export default defineNuxtConfig({
  runtimeConfig: {
    meilisearch: {
      // NUXT_MEILISEARCH_HOST, e.g. http://meilisearch:7700 in DDEV
      host: '',
      // NUXT_MEILISEARCH_API_KEY — an API key with access to the index, not the master key in production
      apiKey: '',
      // NUXT_MEILISEARCH_INDEX
      index: 'mail',
      // NUXT_MEILISEARCH_EMBEDDER_MODEL — Hugging Face model run by Meilisearch, multilingual (German + English); empty disables semantic search
      embedderModel: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
      // NUXT_MEILISEARCH_SEMANTIC_RATIO — 0 = keyword only, 1 = semantic only
      semanticRatio: 0.5,
      // NUXT_MEILISEARCH_RANKING_SCORE_THRESHOLD — guards pure semantic results, relaxed for keyword/typo matches; see settings.ts
      rankingScoreThreshold: 0.65,
      // NUXT_MEILISEARCH_TYPO_TOLERANCE — enable typo tolerance, so "Rechnnug" finds "Rechnung"
      typoTolerance: true,
      // NUXT_MEILISEARCH_TYPO_ONE_TYPO — words this long tolerate one typo
      typoOneTypo: 4,
      // NUXT_MEILISEARCH_TYPO_TWO_TYPOS — words this long tolerate two typos
      typoTwoTypos: 8,
      // NUXT_MEILISEARCH_TYPO_DISABLE_ON_NUMBERS — numbers, amounts and dates must stay exact
      typoDisableOnNumbers: true,
      // NUXT_MEILISEARCH_TYPO_DISABLE_ON_ATTRIBUTES — comma separated attributes exempt from typos; empty = none
      typoDisableOnAttributes: ''
    }
  }
})
