import { describe, expect, it } from 'vitest'
import { indexProgress } from '../shared/mail-index-progress'

describe('indexProgress', () => {
  it('measures the indexed share against the total', () => {
    expect(indexProgress({ indexed: 19_556, total: 25_012, complete: false }))
      .toEqual({ percent: 78, label: '19,556 of 25,012' })
  })

  it('reads full once the service is complete, whatever the counts say', () => {
    expect(indexProgress({ indexed: 10, total: 20, complete: true })).toEqual({ percent: 100, label: '10 of 20' })
    expect(indexProgress({ indexed: 0, total: null, complete: true })).toEqual({ percent: 100, label: '0 messages' })
  })

  it('clamps a share above the total to 100', () => {
    expect(indexProgress({ indexed: 30, total: 20, complete: false })).toEqual({ percent: 100, label: '30 of 20' })
  })

  it('has no percentage without a known total', () => {
    expect(indexProgress({ indexed: 1_234, total: null, complete: false })).toEqual({ percent: 0, label: '1,234 messages' })
    expect(indexProgress({ indexed: 1_234, total: 0, complete: false })).toEqual({ percent: 0, label: '1,234 messages' })
  })
})
