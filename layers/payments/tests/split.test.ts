import { describe, expect, it } from 'vitest'
import { splitAmount } from '../shared/split'

describe('splitAmount', () => {
  it('divides an even total equally', () => {
    expect(splitAmount(1000, 4, 4)).toEqual([250, 250, 250, 250])
  })

  it('gives the payers the rounding cents and leaves the owner the rest', () => {
    const amounts = splitAmount(1799, 6, 5)

    expect(amounts).toEqual([300, 300, 300, 300, 300])
    expect(1799 - amounts.reduce((sum, cents) => sum + cents, 0)).toBe(299)
  })

  it('keeps a payer at the ceil when the owner takes shares', () => {
    expect(splitAmount(1000, 3, 1)).toEqual([334])
  })

  it('never lets a payer exceed the ceil, whatever the number of shares', () => {
    for (let shares = 1; shares <= 12; shares++) {
      for (let payers = 1; payers <= shares; payers++) {
        for (const total of [1, 999, 1000, 1799, 100_001]) {
          const amounts = splitAmount(total, shares, payers)
          const ceil = Math.ceil(total / shares)
          expect(amounts).toHaveLength(payers)
          expect(amounts.every(cents => cents <= ceil)).toBe(true)
        }
      }
    }
  })

  it('sums to the total when everyone is a payer', () => {
    const amounts = splitAmount(1799, 6, 6)

    expect(amounts.reduce((sum, cents) => sum + cents, 0)).toBe(1799)
    expect(amounts.at(-1)).toBe(299)
  })

  it.each([
    { name: 'a zero total', total: 0, shares: 3, payers: 2 },
    { name: 'a negative total', total: -100, shares: 3, payers: 2 },
    { name: 'a fractional total', total: 100.5, shares: 3, payers: 2 },
    { name: 'no shares', total: 1000, shares: 0, payers: 1 },
    { name: 'no payers', total: 1000, shares: 3, payers: 0 },
    { name: 'more payers than shares', total: 1000, shares: 3, payers: 4 },
    { name: 'a fractional share count', total: 1000, shares: 2.5, payers: 1 }
  ])('rejects $name', ({ total, shares, payers }) => {
    expect(() => splitAmount(total, shares, payers)).toThrow()
  })
})
