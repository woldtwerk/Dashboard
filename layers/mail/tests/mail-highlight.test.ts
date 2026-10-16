import { describe, expect, it } from 'vitest'
import { escapeHtml, highlightToHtml, HIGHLIGHT_POST_TAG, HIGHLIGHT_PRE_TAG } from '../shared/mail-highlight'

describe('escapeHtml', () => {
  it('escapes the HTML special characters', () => {
    expect(escapeHtml(`<img src="x" onerror='y'>&`)).toBe('&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;')
  })
})

describe('highlightToHtml', () => {
  it('turns the index markers into <mark> and escapes the text', () => {
    expect(highlightToHtml(`${HIGHLIGHT_PRE_TAG}Rechnnug${HIGHLIGHT_POST_TAG} bezahlt`)).toBe('<mark>Rechnnug</mark> bezahlt')
  })

  it('escapes a literal <mark> inside the mail like any other text', () => {
    expect(highlightToHtml(`${HIGHLIGHT_PRE_TAG}Rechnung${HIGHLIGHT_POST_TAG} <mark>evil</mark>`))
      .toBe('<mark>Rechnung</mark> &lt;mark&gt;evil&lt;/mark&gt;')
  })

  it('never lets mail content inject markup', () => {
    expect(highlightToHtml(`<script>alert(1)</script> ${HIGHLIGHT_PRE_TAG}Rechnung${HIGHLIGHT_POST_TAG}`))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt; <mark>Rechnung</mark>')
  })

  it('escapes plain text from the provider as a whole', () => {
    expect(highlightToHtml('a & b < c')).toBe('a &amp; b &lt; c')
  })

  it('handles missing values', () => {
    expect(highlightToHtml()).toBe('')
    expect(highlightToHtml('')).toBe('')
  })
})
