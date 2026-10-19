import { describe, expect, it } from 'vitest'
import {
  formatToolSourceDate,
  isPastToolSource,
  safeToolSourceLink,
  toolFallbackText,
  toolProgressText,
  toolResultCount,
  toolResultText,
  toolSourceIcon,
  toolSources
} from '../app/utils/assistant-tools'

describe('toolSources', () => {
  it('reads the source cards of the new tool output', () => {
    const sources = toolSources('documents_search', {
      documents: [],
      sources: [{ kind: 'document', title: 'Invoice', subtitle: '#42', date: '2026-10-01', link: '/documents/42' }]
    })

    expect(sources).toEqual([{ kind: 'document', title: 'Invoice', subtitle: '#42', date: '2026-10-01', link: '/documents/42' }])
  })

  it('maps the old mail_search output to mail cards', () => {
    const sources = toolSources('mail_search', { results: [{ subject: 'Hello', from: 'a@b.c', date: '2026-10-01T10:00:00Z', link: '/mail?uid=1' }] })

    expect(sources).toEqual([{ kind: 'mail', title: 'Hello', subtitle: 'a@b.c', date: '2026-10-01T10:00:00Z', link: '/mail?uid=1' }])
  })

  it('maps the old mail_read output to one card', () => {
    expect(toolSources('mail_read', { subject: 'Hello', link: '/mail?uid=1' })).toHaveLength(1)
  })

  it('ignores malformed cards and unknown output', () => {
    expect(toolSources('documents_search', { sources: [{ title: 'no kind' }, 'nope'] })).toEqual([])
    expect(toolSources('other', { whatever: true })).toEqual([])
  })
})

describe('tool result helpers', () => {
  it('counts the items of an old output', () => {
    expect(toolResultCount({ documents: [1, 2, 3] })).toBe(3)
    expect(toolResultCount({ events: [1] })).toBe(1)
    expect(toolResultCount({ count: 7 })).toBe(7)
    expect(toolResultCount(undefined)).toBe(0)
  })

  it('labels results from the source kind, with a generic fallback', () => {
    expect(toolResultText([{ kind: 'document', title: 'a' }])).toBe('Found 1 document')
    expect(toolResultText([{ kind: 'document', title: 'a' }, { kind: 'document', title: 'b' }])).toBe('Found 2 documents')
    expect(toolResultText([])).toBe('Found 0 results')
    expect(toolResultText([], 4)).toBe('Found 4 results')
  })

  it('falls back to a plain result line for old output', () => {
    expect(toolFallbackText({ results: [{}, {}] })).toBe('Found 2 results')
    expect(toolFallbackText({})).toBe('Tool finished')
  })

  it('names the running tool without knowing its domain', () => {
    expect(toolProgressText('documents_search')).toBe('Searching documents…')
    expect(toolProgressText('mail_search')).toBe('Searching mail…')
    expect(toolProgressText('calendar_list_events')).toBe('Listing calendar events…')
    expect(toolProgressText('mystery_tool')).toBe('Running mystery_tool…')
  })

  it('maps a kind to an icon and falls back for unknown kinds', () => {
    expect(toolSourceIcon('mail')).toBe('i-lucide-mail')
    expect(toolSourceIcon('event')).toBe('i-lucide-calendar')
    expect(toolSourceIcon('mystery')).toBe('i-lucide-file')
  })
})

describe('source dates and links', () => {
  const now = new Date('2026-10-19T12:00:00Z')

  it('formats a readable date and rejects an unreadable one', () => {
    expect(formatToolSourceDate('2026-10-01', 'UTC')).toMatch(/Oct 2026/)
    expect(formatToolSourceDate('not a date', 'UTC')).toBeUndefined()
    expect(formatToolSourceDate(undefined, 'UTC')).toBeUndefined()
  })

  it('marks only dates before today as past', () => {
    expect(isPastToolSource('2026-10-01', now, 'UTC')).toBe(true)
    expect(isPastToolSource('2026-10-19', now, 'UTC')).toBe(false)
    expect(isPastToolSource('2026-10-25', now, 'UTC')).toBe(false)
    expect(isPastToolSource(undefined, now, 'UTC')).toBe(false)
  })

  it('only returns a link that is safe to render', () => {
    expect(safeToolSourceLink('/mail?uid=1')).toBe('/mail?uid=1')
    expect(safeToolSourceLink('javascript:alert(1)')).toBeUndefined()
    expect(safeToolSourceLink(undefined)).toBeUndefined()
  })
})
