import { describe, expect, it } from 'vitest'
import { cacheDbPath } from '../server/utils/cache-path'

describe('cacheDbPath', () => {
  it('puts a domain database in the cache directory', () => {
    expect(cacheDbPath('.data/cache', 'calendar')).toBe('.data/cache/calendar.sqlite')
  })

  it('accepts lower-case names with digits and dashes', () => {
    expect(cacheDbPath('/tmp/cache', 'mail-2')).toBe('/tmp/cache/mail-2.sqlite')
  })

  it('rejects a domain that could leave the directory', () => {
    for (const domain of ['', '../calendar', 'Calendar', 'cal/endar', 'cal_endar', 'cal endar']) {
      expect(() => cacheDbPath('/tmp/cache', domain)).toThrow('Invalid cache database domain')
    }
  })
})
