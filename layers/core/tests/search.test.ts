import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchHit } from '../shared/types/search'
import { registerSearchProvider, resetSearchProviders, searchAll } from '../server/utils/search'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))

vi.mock('../server/utils/service-logger', () => ({
  useServiceLogger: () => ({ warn })
}))

const hit = (title: string, extra: Partial<SearchHit> = {}): SearchHit => ({
  ref: `${extra.match ?? 'keyword'}:svc:${title}`,
  title,
  to: `/open?title=${title}`,
  ...extra
})

describe('searchAll', () => {
  beforeEach(() => {
    resetSearchProviders()
    warn.mockReset()
  })

  it('runs every provider in parallel and keeps the non-empty groups', async () => {
    registerSearchProvider({ domain: 'mail', label: 'Mail', icon: 'i-lucide-mail', search: async () => [hit('a mail')] })
    registerSearchProvider({ domain: 'empty', label: 'Empty', search: async () => [] })

    const { groups, top } = await searchAll('a')

    expect(groups.map(group => group.domain)).toEqual(['mail'])
    expect(groups[0]).toMatchObject({ label: 'Mail', icon: 'i-lucide-mail' })
    expect(groups[0]!.hits).toHaveLength(1)
    expect(top).toHaveLength(1)
    expect(top[0]).toMatchObject({ domain: 'mail', domainLabel: 'Mail', icon: 'i-lucide-mail' })
  })

  it('skips a provider that fails and logs it', async () => {
    registerSearchProvider({
      domain: 'broken',
      label: 'Broken',
      search: async () => {
        throw new Error('nope')
      }
    })
    registerSearchProvider({ domain: 'mail', label: 'Mail', search: async () => [hit('a mail')] })

    const { groups } = await searchAll('a')

    expect(groups.map(group => group.domain)).toEqual(['mail'])
    expect(warn).toHaveBeenCalledWith('Search of "broken" is unavailable', expect.objectContaining({ error: 'nope' }))
  })

  it('leaves out a provider that exceeds its timeout', async () => {
    registerSearchProvider({ domain: 'slow', label: 'Slow', search: () => new Promise<SearchHit[]>(() => {}) })
    registerSearchProvider({ domain: 'fast', label: 'Fast', search: async () => [hit('a mail')] })

    const { groups } = await searchAll('a', 5, 5)

    expect(groups.map(group => group.domain)).toEqual(['fast'])
    expect(warn).toHaveBeenCalledWith('Search of "slow" is unavailable', expect.objectContaining({ error: expect.any(String) }))
  })

  it('passes the limit through to the provider', async () => {
    const search = vi.fn(async (_q: string, limit: number) => Array.from({ length: limit }, (_, index) => hit(`a mail ${index}`)))
    registerSearchProvider({ domain: 'x', label: 'X', search })

    const { groups } = await searchAll('a', 3)

    expect(search).toHaveBeenCalledWith('a', 3)
    expect(groups[0]!.hits).toHaveLength(3)
  })

  it('ranks a keyword document above semantic mail hits and drops mail without the term', async () => {
    registerSearchProvider({
      domain: 'mail',
      label: 'Mail',
      icon: 'i-lucide-mail',
      search: async () => Array.from({ length: 5 }, (_, index) => hit(`Setenta ${index}`, {
        match: 'semantic',
        providerScore: 0.7,
        snippet: 'Wir bearbeiten Ihre Bestellung'
      }))
    })
    registerSearchProvider({
      domain: 'documents',
      label: 'Documents',
      icon: 'i-lucide-file-search',
      search: async () => [hit('140525 Zwischenzeugnis Willi Woldt')]
    })

    const { top, groups } = await searchAll('zeugnis')

    expect(groups[0]!.domain).toBe('documents')
    expect(top[0]).toMatchObject({ domain: 'documents' })
    expect(top[0]!.title).toContain('Zwischenzeugnis')

    const mailGroup = groups.find(group => group.domain === 'mail')
    expect(mailGroup?.hits).toHaveLength(5)
    expect(mailGroup?.hits.every(hit => hit.match === 'semantic')).toBe(true)
  })

  it('fills the top group with semantic hits only when fewer than the limit keyword hits exist', async () => {
    registerSearchProvider({
      domain: 'mail',
      label: 'Mail',
      search: async () => [
        hit('Zeugnis Bericht'),
        hit('Setenta', { match: 'semantic', providerScore: 0.7 })
      ]
    })

    const { top } = await searchAll('zeugnis')

    expect(top.map(item => item.match === 'semantic')).toEqual([false, true])
  })

  it('drops a semantic hit below the score floor', async () => {
    registerSearchProvider({
      domain: 'mail',
      label: 'Mail',
      search: async () => [hit('Setenta', { match: 'semantic', providerScore: 0.3 })]
    })

    const { top, groups } = await searchAll('zeugnis')

    expect(groups).toEqual([])
    expect(top).toEqual([])
  })

  it('fills a highlight for a hit the provider returned without markers', async () => {
    registerSearchProvider({ domain: 'documents', label: 'Documents', search: async () => [hit('140525 Zwischenzeugnis')] })

    const { groups } = await searchAll('zeugnis')

    expect(groups[0]!.hits[0]!.titleHighlight).toContain('\uE000')
  })
})
