import { describe, expect, it } from 'vitest'
import { matchPayment } from '../shared/match'
import type { OpenRequest } from '../shared/match'

const open: OpenRequest[] = [
  { id: 'anna', reference: 'AM-AAAAAA', amountCents: 1799, payerName: 'Anna Müller' },
  { id: 'ben', reference: 'AM-BBBBBB', amountCents: 1799, payerName: 'Ben Schmidt' },
  { id: 'cara', reference: 'AM-CCCCCC', amountCents: 5000, payerName: 'Cara' },
  { id: 'anna-2', reference: 'AM-DDDDDD', amountCents: 1200, payerName: 'Anna Müller' },
  { id: 'anna-3', reference: 'AM-EEEEEE', amountCents: 1200, payerName: 'Anna Müller' }
]

describe('matchPayment', () => {
  it('lets a reference win over the amount and the payer name', () => {
    const result = matchPayment(open, { amountCents: 1200, payerName: 'Ben Schmidt', text: 'Dinner AM-AAAAAA' })

    expect(result).toEqual({ kind: 'reference', request: open[0] })
  })

  it('matches a reference even when only part of the amount arrived', () => {
    const result = matchPayment(open, { amountCents: 1000, payerName: 'Cara', text: 'AM CCCCCC' })

    expect(result).toEqual({ kind: 'reference', request: open[2] })
  })

  it('falls through when the reference belongs to no open request', () => {
    const result = matchPayment(open, { amountCents: 5000, payerName: 'Cara', text: 'AM-ZZZZZZ' })

    expect(result).toEqual({ kind: 'amount-name', request: open[2] })
  })

  it('matches one amount and payer name, ignoring case and umlauts', () => {
    const result = matchPayment(open, { amountCents: 1799, payerName: 'ANNA MÜLLER' })

    expect(result).toEqual({ kind: 'amount-name', request: open[0] })
  })

  it('matches when the shorter name is one word of the longer one', () => {
    const result = matchPayment(open, { amountCents: 1799, payerName: 'anna' })

    expect(result).toEqual({ kind: 'amount-name', request: open[0] })
  })

  it('reports several matching requests as ambiguous', () => {
    const result = matchPayment(open, { amountCents: 1200, payerName: 'Anna' })

    expect(result).toEqual({ kind: 'ambiguous', candidates: [open[3], open[4]] })
  })

  it('does not match on an amount alone', () => {
    expect(matchPayment(open, { amountCents: 1799 })).toEqual({ kind: 'none' })
  })

  it('does not match a different amount or name', () => {
    expect(matchPayment(open, { amountCents: 1799, payerName: 'Cara' })).toEqual({ kind: 'none' })
    expect(matchPayment(open, { amountCents: 999, payerName: 'Anna Müller' })).toEqual({ kind: 'none' })
  })
})
