import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_POST_TAG, HIGHLIGHT_PRE_TAG } from '../../core/shared/highlight'
import { fromPaperlessHighlights } from '../server/paperless/highlight'

const marked = (text: string) => `${HIGHLIGHT_PRE_TAG}${text}${HIGHLIGHT_POST_TAG}`

describe('fromPaperlessHighlights', () => {
  it('turns the match spans into the highlight markers', () => {
    const html = 'Die <span class="match">Rechnung</span> fuer <span class="match">Oktober</span>'

    expect(fromPaperlessHighlights(html)).toBe(`Die ${marked('Rechnung')} fuer ${marked('Oktober')}`)
  })

  it('strips every other tag and decodes entities', () => {
    expect(fromPaperlessHighlights('<p>A &amp; <b>B</b> &lt;C&gt;</p>')).toBe('A & B <C>')
  })

  it('drops script and style blocks with their content', () => {
    expect(fromPaperlessHighlights(`<span class="match">Rechnung</span><script>alert(1)</script>`)).toBe(marked('Rechnung'))
    expect(fromPaperlessHighlights(`<style>body{}</style><span class="match">x</span>`)).toBe(marked('x'))
  })

  it('does not mark a class that is not exactly "match"', () => {
    expect(fromPaperlessHighlights('<span class="no-match">x</span>')).toBe('x')
  })

  it('balances an unclosed match and drops a stray close', () => {
    expect(fromPaperlessHighlights('<span class="match">Rechnung')).toBe(marked('Rechnung'))
    expect(fromPaperlessHighlights('</span> stray')).toBe('stray')
  })

  it('never lets an injection attempt through as markup', () => {
    expect(fromPaperlessHighlights('<img src=x onerror="alert(1)">ok')).toBe('ok')
    expect(fromPaperlessHighlights('<span class="match" onclick="evil()">x</span>')).toBe(marked('x'))
    expect(fromPaperlessHighlights('<span class="match">a</span><span onmouseover="evil()">b</span>')).toBe(`${marked('a')}b`)
  })

  it('handles a missing or empty excerpt', () => {
    expect(fromPaperlessHighlights(undefined)).toBeUndefined()
    expect(fromPaperlessHighlights(null)).toBeUndefined()
    expect(fromPaperlessHighlights('')).toBeUndefined()
    expect(fromPaperlessHighlights('   ')).toBeUndefined()
  })
})
