import { describe, expect, it, beforeEach } from 'vitest'
import {
  addFallback,
  createDecisionFallback,
  decisionFallbackLabel,
  decisionFallbackTypes,
  fallbackChainLabel,
  moveFallback,
  registerDecisionFallback,
  removeFallback,
  resetDecisionFallbacks
} from '../app/utils/decision-fallbacks'
import type { DecisionFallback } from '../shared/types/automation'

beforeEach(() => {
  resetDecisionFallbacks()
  registerDecisionFallback({ type: 'human', label: 'Human check', chainLabel: 'Human', icon: 'i-lucide-user-check' })
})

describe('the fallback registry', () => {
  it('lists the registered kinds in order', () => {
    registerDecisionFallback({ type: 'ai', label: 'AI model', chainLabel: 'AI', icon: 'i-lucide-sparkles' })
    expect(decisionFallbackTypes().map(entry => entry.type)).toEqual(['human', 'ai'])
  })

  it('falls back to the raw type for an unregistered one', () => {
    expect(decisionFallbackLabel('ai')).toBe('ai')
  })
})

describe('createDecisionFallback', () => {
  it('starts an AI entry on the default model', () => {
    expect(createDecisionFallback('ai')).toEqual({ type: 'ai', model: '' })
    expect(createDecisionFallback('human')).toEqual({ type: 'human' })
  })
})

describe('addFallback', () => {
  it('appends to the end of the chain', () => {
    expect(addFallback(undefined, 'ai')).toEqual([{ type: 'ai', model: '' }])
    expect(addFallback([{ type: 'ai', model: 's:m' }], 'human')).toEqual([{ type: 'ai', model: 's:m' }, { type: 'human' }])
  })

  it('does not add a second human check', () => {
    const chain: DecisionFallback[] = [{ type: 'human' }]
    expect(addFallback(chain, 'human')).toEqual(chain)
  })

  it('leaves the original untouched', () => {
    const chain: DecisionFallback[] = [{ type: 'human' }]
    addFallback(chain, 'ai')
    expect(chain).toEqual([{ type: 'human' }])
  })
})

describe('removeFallback', () => {
  it('drops one entry by position', () => {
    const chain: DecisionFallback[] = [{ type: 'ai', model: 'a' }, { type: 'ai', model: 'b' }, { type: 'human' }]
    expect(removeFallback(chain, 0)).toEqual([{ type: 'ai', model: 'b' }, { type: 'human' }])
  })
})

describe('moveFallback', () => {
  it('swaps an entry with its neighbour', () => {
    const chain: DecisionFallback[] = [{ type: 'ai', model: 'a' }, { type: 'ai', model: 'b' }, { type: 'human' }]
    expect(moveFallback(chain, 1, -1)).toEqual([{ type: 'ai', model: 'b' }, { type: 'ai', model: 'a' }, { type: 'human' }])
    expect(moveFallback(chain, 0, 1)).toEqual([{ type: 'ai', model: 'b' }, { type: 'ai', model: 'a' }, { type: 'human' }])
  })

  it('ignores a move past either end', () => {
    const chain: DecisionFallback[] = [{ type: 'human' }]
    expect(moveFallback(chain, 0, -1)).toEqual(chain)
    expect(moveFallback(chain, 0, 1)).toEqual(chain)
  })

  it('never moves a human check away from the end', () => {
    const chain: DecisionFallback[] = [{ type: 'ai', model: 'a' }, { type: 'human' }]
    expect(moveFallback(chain, 1, -1)).toEqual(chain)
    expect(moveFallback(chain, 0, 1)).toEqual(chain)
  })
})

describe('fallbackChainLabel', () => {
  it('joins the chain with arrows', () => {
    registerDecisionFallback({ type: 'ai', label: 'AI model', chainLabel: 'AI', icon: 'i-lucide-sparkles' })
    expect(fallbackChainLabel([{ type: 'ai', model: '' }, { type: 'human' }])).toBe('AI → Human')
  })

  it('is empty without fallbacks', () => {
    expect(fallbackChainLabel(undefined)).toBe('')
    expect(fallbackChainLabel([])).toBe('')
  })
})
