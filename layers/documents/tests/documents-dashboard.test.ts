import { describe, expect, it } from 'vitest'
import { weekRanges } from '../server/utils/documents-dashboard'

const today = new Date('2026-10-18T15:00:00.000Z')

describe('weekRanges', () => {
  it('returns calendar weeks starting on Monday, oldest first', () => {
    const ranges = weekRanges(today, 12)

    expect(ranges).toHaveLength(12)
    expect(ranges[0]).toEqual({ since: '2026-07-27', until: '2026-08-03' })
    expect(ranges.at(-1)).toEqual({ since: '2026-10-12', until: '2026-10-19' })

    for (const range of ranges) {
      expect(new Date(`${range.since}T00:00:00Z`).getUTCDay()).toBe(1)
    }
  })

  it('defaults to twelve weeks and never returns an empty list', () => {
    expect(weekRanges(today)).toHaveLength(12)
    expect(weekRanges(today, 0)).toEqual([{ since: '2026-10-12', until: '2026-10-19' }])
  })

  it('makes consecutive ranges without overlap', () => {
    const ranges = weekRanges(today, 4)

    for (let index = 1; index < ranges.length; index++) {
      expect(ranges[index]!.since).toBe(ranges[index - 1]!.until)
    }
  })
})
