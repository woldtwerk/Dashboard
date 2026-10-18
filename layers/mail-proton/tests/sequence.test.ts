import { describe, expect, it } from 'vitest'
import { sequenceRange, uidPage } from '../server/proton/sequence'

describe('sequenceRange', () => {
  it('walks down from the newest sequence number', () => {
    expect(sequenceRange(10, 0, 3)).toEqual({ start: 8, end: 10 })
    expect(sequenceRange(10, 3, 3)).toEqual({ start: 5, end: 7 })
  })

  it('clamps the start at 1, so the last page is short', () => {
    expect(sequenceRange(10, 8, 3)).toEqual({ start: 1, end: 2 })
    expect(sequenceRange(2, 0, 50)).toEqual({ start: 1, end: 2 })
  })

  it('is empty once the offset reaches the mailbox', () => {
    expect(sequenceRange(10, 10, 3)).toBeUndefined()
    expect(sequenceRange(10, 12, 3)).toBeUndefined()
    expect(sequenceRange(0, 0, 50)).toBeUndefined()
  })
})

describe('uidPage', () => {
  it('sorts newest (highest) first and pages through the list', () => {
    expect(uidPage([5, 1, 9, 3], 0, 2)).toEqual([9, 5])
    expect(uidPage([5, 1, 9, 3], 2, 2)).toEqual([3, 1])
    expect(uidPage([5, 1, 9, 3], 4, 2)).toEqual([])
  })
})
