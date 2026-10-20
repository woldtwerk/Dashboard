import { describe, expect, it } from 'vitest'
import { isReviewEvent, REVIEW_EVENT_RESOURCE, REVIEW_EVENT_TYPE } from '../shared/events'

describe('review events', () => {
  it('recognises the review event the badge listens to', () => {
    expect(isReviewEvent(REVIEW_EVENT_TYPE)).toBe(true)
  })

  it('ignores the pop-up and other automation events', () => {
    expect(isReviewEvent('modal')).toBe(false)
    expect(isReviewEvent('changed')).toBe(false)
  })

  it('keeps the review resource distinct from a modal reference', () => {
    expect(REVIEW_EVENT_RESOURCE).toBe('runs:review')
  })
})
