import { describe, expect, it } from 'vitest'
import { isSafeAssistantLink } from '../app/utils/markdown-link'
import { renderAssistantMarkdown } from '../app/utils/markdown'

describe('isSafeAssistantLink', () => {
  it('accepts in-app paths and https URLs', () => {
    expect(isSafeAssistantLink('/mail?service=s&uid=1')).toBe(true)
    expect(isSafeAssistantLink('/')).toBe(true)
    expect(isSafeAssistantLink('https://example.com/a?b=1')).toBe(true)
  })

  it('rejects every scripting or data URL', () => {
    expect(isSafeAssistantLink('javascript:alert(1)')).toBe(false)
    expect(isSafeAssistantLink('JaVaScRiPt:alert(1)')).toBe(false)
    expect(isSafeAssistantLink('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeAssistantLink('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeAssistantLink('mailto:a@example.com')).toBe(false)
  })

  it('rejects protocol-relative and backslash origins', () => {
    expect(isSafeAssistantLink('//evil.example.com')).toBe(false)
    expect(isSafeAssistantLink('/\\evil.example.com')).toBe(false)
    expect(isSafeAssistantLink('/path\\to')).toBe(false)
  })

  it('rejects plain http and malformed https', () => {
    expect(isSafeAssistantLink('http://example.com')).toBe(false)
    expect(isSafeAssistantLink('https:/example.com')).toBe(false)
    expect(isSafeAssistantLink('https://')).toBe(false)
  })

  it('rejects control characters and non-strings', () => {
    expect(isSafeAssistantLink('java\nscript:alert(1)')).toBe(false)
    expect(isSafeAssistantLink('/path\u0000')).toBe(false)
    expect(isSafeAssistantLink(undefined)).toBe(false)
    expect(isSafeAssistantLink(42)).toBe(false)
  })
})

describe('renderAssistantMarkdown', () => {
  it('renders paragraphs, lists and bold', () => {
    const html = renderAssistantMarkdown('**Hi**\n\n- one\n- two')

    expect(html).toContain('<strong>Hi</strong>')
    expect(html).toContain('<li>one</li>')
  })

  it('renders a table with rows', () => {
    const html = renderAssistantMarkdown('| Date | Title |\n| --- | --- |\n| 1 Oct | Ticket |')

    expect(html).toContain('<table>')
    expect(html).toContain('<th>Date</th>')
    expect(html).toContain('<td>Ticket</td>')
  })

  it('escapes raw HTML instead of rendering it', () => {
    const html = renderAssistantMarkdown('<script>alert(1)</script><img src=x onerror=alert(2)>')

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('turns an image into its alt text, so no tracking pixel loads', () => {
    const html = renderAssistantMarkdown('![pixel](https://tracker.example.com/open.png)')

    expect(html).not.toContain('<img')
    expect(html).not.toContain('tracker.example.com')
    expect(html).toContain('pixel')
  })

  it('keeps an https link and opens it in a new tab', () => {
    const html = renderAssistantMarkdown('[site](https://example.com/page)')

    expect(html).toContain('href="https://example.com/page"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
  })

  it('keeps an in-app link without a new tab', () => {
    const html = renderAssistantMarkdown('[mail](/mail?service=s&uid=1)')

    expect(html).toContain('href="/mail?service=s&amp;uid=1"')
    expect(html).not.toContain('target="_blank"')
  })

  it('drops javascript, data and protocol-relative links', () => {
    expect(renderAssistantMarkdown('[x](javascript:alert(1))')).not.toContain('href="javascript')
    expect(renderAssistantMarkdown('[x](data:text/html,evil)')).not.toContain('href="data:')
    expect(renderAssistantMarkdown('[x](//evil.example.com)')).not.toContain('href="//evil')
  })

  it('drops unsafe autolinks and reference definitions', () => {
    expect(renderAssistantMarkdown('<javascript:alert(1)>')).not.toContain('href="javascript')
    expect(renderAssistantMarkdown('[x][1]\n\n[1]: data:text/html,evil')).not.toContain('href="data:')
  })

  it('renders partial Markdown while the answer streams', () => {
    expect(() => renderAssistantMarkdown('**bo')).not.toThrow()
    expect(renderAssistantMarkdown('**bo')).toContain('bo')
  })
})
