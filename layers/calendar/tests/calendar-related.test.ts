import { describe, expect, it } from 'vitest'
import type { Relation } from '#layers/core/shared/types/entities'
import { splitRelatedEvents } from '../app/utils/calendar-related'

const event = (title: string, at?: string): Relation => ({
  kind: 'attendee',
  weight: 1,
  item: { ref: { type: 'event', service: 'work', id: title }, title, at, to: `/calendar?event=${title}` }
})

const now = new Date('2026-06-15T12:00:00Z')

describe('splitRelatedEvents', () => {
  it('splits around now, soonest upcoming first and most recent past first', () => {
    const { upcoming, past } = splitRelatedEvents([
      event('later', '2026-06-20T10:00:00Z'),
      event('older', '2026-06-01T10:00:00Z'),
      event('sooner', '2026-06-16T10:00:00Z'),
      event('recent', '2026-06-14T10:00:00Z')
    ], now)

    expect(upcoming.map(item => item.item.title)).toEqual(['sooner', 'later'])
    expect(past.map(item => item.item.title)).toEqual(['recent', 'older'])
  })

  it('treats an event without a date as upcoming and keeps it stable', () => {
    const { upcoming, past } = splitRelatedEvents([event('undated'), event('later', '2026-06-20T10:00:00Z')], now)

    expect(upcoming.map(item => item.item.title)).toEqual(['undated', 'later'])
    expect(past).toEqual([])
  })

  it('keeps an event starting exactly now on the upcoming side', () => {
    const { upcoming, past } = splitRelatedEvents([event('now', now.toISOString())], now)
    expect(upcoming).toHaveLength(1)
    expect(past).toHaveLength(0)
  })
})
