import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_POST_TAG, HIGHLIGHT_PRE_TAG, highlightToHtml } from '../shared/highlight'
import { highlightTerms, relevance } from '../shared/search-ranking'

describe('relevance', () => {
  it('scores a whole word in the title above a word part in the title', () => {
    expect(relevance({ title: 'Zeugnis Willi' }, 'zeugnis')).toBe(1)
    expect(relevance({ title: 'Zwischenzeugnis Willi' }, 'zeugnis')).toBe(0.85)
  })

  it('scores a title match above a snippet match', () => {
    expect(relevance({ title: 'Zeugnis' }, 'zeugnis')).toBeGreaterThan(
      relevance({ title: 'Bericht', snippet: 'ein bedeutendes Zeugnis der Festung' }, 'zeugnis')
    )
    expect(relevance({ title: 'Bericht', snippet: 'ein bedeutendes Zeugnis der Festung' }, 'zeugnis')).toBe(0.6)
  })

  it('folds umlauts and case', () => {
    expect(relevance({ title: 'Zeugnisse' }, 'zeugnis')).toBe(0.85)
    expect(relevance({ title: 'Zeugnis' }, 'ZEUGNIS')).toBe(1)
  })

  it('requires every term (AND)', () => {
    expect(relevance({ title: 'Zwischenzeugnis Willi' }, 'zeugnis willi')).toBeGreaterThan(0)
    expect(relevance({ title: 'Zwischenzeugnis Willi' }, 'zeugnis woldt')).toBe(0)
  })

  it('returns 0 for a hit without the term', () => {
    expect(relevance({ title: 'Setenta', snippet: 'Wir bearbeiten Ihre Bestellung' }, 'zeugnis')).toBe(0)
  })

  it('scores a semantic hit far below a keyword hit and drops a weak one', () => {
    const semantic = relevance({ title: 'Setenta', match: 'semantic', providerScore: 0.7 }, 'zeugnis')
    expect(semantic).toBeCloseTo(0.31)
    expect(semantic).toBeLessThan(relevance({ title: 'Zwischenzeugnis' }, 'zeugnis'))
    expect(relevance({ title: 'Setenta', match: 'semantic', providerScore: 0.3 }, 'zeugnis')).toBe(0)
  })
})

describe('highlightTerms', () => {
  it('marks a word part case-insensitively', () => {
    const marked = highlightTerms('140525 Zwischenzeugnis Willi Woldt', 'zeugnis')
    expect(marked).toContain(`${HIGHLIGHT_PRE_TAG}zeugnis${HIGHLIGHT_POST_TAG}`)
    expect(marked).toContain('Zwischen')
  })

  it('marks an umlaut query against its folded word', () => {
    expect(highlightTerms('Ein Zeugnis', 'zeugnis')).toContain(`${HIGHLIGHT_PRE_TAG}Zeugnis${HIGHLIGHT_POST_TAG}`)
  })

  it('leaves the text alone without a match', () => {
    expect(highlightTerms('Setenta', 'zeugnis')).toBe('Setenta')
  })

  it('keeps escaping in highlightToHtml', () => {
    const marked = highlightTerms('a <b> zeugnis', 'zeugnis')
    const html = highlightToHtml(marked)

    expect(html).toContain('<mark>zeugnis</mark>')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
  })
})
