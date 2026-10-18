import { describe, expect, it } from 'vitest'
import { buildIndexSettings, buildTypoTolerance, EMBEDDER, HYBRID_RANKING_SCORE_FLOOR, rankingScoreThresholdFor } from '../server/meilisearch/settings'

const options = {
  semantic: true,
  embedderModel: 'model',
  typoTolerance: true,
  typoOneTypo: 4,
  typoTwoTypos: 8,
  typoDisableOnNumbers: true,
  typoDisableOnAttributes: []
}

describe('buildTypoTolerance', () => {
  it('enables typos with the configured word sizes and no exempt attributes', () => {
    expect(buildTypoTolerance(options)).toEqual({
      enabled: true,
      disableOnAttributes: [],
      disableOnNumbers: true,
      minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 }
    })
  })
})

describe('buildIndexSettings', () => {
  it('filters by every document field, including attachments and sender terms', () => {
    const settings = buildIndexSettings(options)

    expect(settings.filterableAttributes).toContain('hasAttachment')
    expect(settings.filterableAttributes).toContain('fromTerms')
    expect(settings.filterableAttributes).toContain('participantTerms')
    expect(settings.filterableAttributes).toContain('conversationKeys')
    expect(settings.filterableAttributes).toContain('listId')
    expect(settings.typoTolerance).toEqual(buildTypoTolerance(options))
  })

  it('only configures the embedder for semantic search', () => {
    expect(buildIndexSettings({ ...options, semantic: false }).embedders).toEqual({})
    expect(buildIndexSettings(options).embedders).toMatchObject({ [EMBEDDER]: { source: 'huggingFace', model: 'model' } })
  })
})

describe('rankingScoreThresholdFor', () => {
  it('has no threshold for keyword-only search', () => {
    expect(rankingScoreThresholdFor(false, 0.5, 0.65)).toBeUndefined()
  })

  it('keeps the configured threshold for pure semantic search', () => {
    expect(rankingScoreThresholdFor(true, 1, 0.65)).toBe(0.65)
  })

  it('relaxes it for hybrid search so typo keyword matches survive', () => {
    expect(rankingScoreThresholdFor(true, 0.5, 0.65)).toBe(HYBRID_RANKING_SCORE_FLOOR)
    expect(rankingScoreThresholdFor(true, 0.5, 0.1)).toBe(0.1)
  })

  it('disables the threshold when it is not set', () => {
    expect(rankingScoreThresholdFor(true, 1, 0)).toBeUndefined()
  })
})
