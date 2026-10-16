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
      // NUXT_MEILISEARCH_RANKING_SCORE_THRESHOLD — hits below are dropped; semantic search otherwise returns every mail
      rankingScoreThreshold: 0.65
    }
  }
})
