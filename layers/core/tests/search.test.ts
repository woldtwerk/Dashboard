import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchHit } from '../shared/types/search'
import { registerSearchProvider, resetSearchProviders, searchAll } from '../server/utils/search'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))

vi.mock('../server/utils/service-logger', () => ({
  useServiceLogger: () => ({ warn })
}))

const hit = (title: string): SearchHit => ({ ref: `mail:svc:${title}`, title, to: `/mail?uid=${title}` })

describe('searchAll', () => {
  beforeEach(() => {
    resetSearchProviders()
    warn.mockReset()
  })

  it('runs every provider in parallel and keeps the non-empty groups', async () => {
    registerSearchProvider({ domain: 'mail', label: 'Mail', icon: 'i-lucide-mail', search: async () => [hit('a')] })
    registerSearchProvider({ domain: 'empty', label: 'Empty', search: async () => [] })

    const groups = await searchAll('a')

    expect(groups.map(group => group.domain)).toEqual(['mail'])
    expect(groups[0]).toMatchObject({ label: 'Mail', icon: 'i-lucide-mail' })
    expect(groups[0]!.hits).toHaveLength(1)
  })

  it('skips a provider that fails and logs it', async () => {
    registerSearchProvider({
      domain: 'broken',
      label: 'Broken',
      search: async () => {
        throw new Error('nope')
      }
    })
    registerSearchProvider({ domain: 'mail', label: 'Mail', search: async () => [hit('a')] })

    const groups = await searchAll('a')

    expect(groups.map(group => group.domain)).toEqual(['mail'])
    expect(warn).toHaveBeenCalledWith('Search of "broken" is unavailable', expect.objectContaining({ error: 'nope' }))
  })

  it('leaves out a provider that exceeds its timeout', async () => {
    registerSearchProvider({ domain: 'slow', label: 'Slow', search: () => new Promise<SearchHit[]>(() => {}) })
    registerSearchProvider({ domain: 'fast', label: 'Fast', search: async () => [hit('a')] })

    const groups = await searchAll('a', 5, 5)

    expect(groups.map(group => group.domain)).toEqual(['fast'])
    expect(warn).toHaveBeenCalledWith('Search of "slow" is unavailable', expect.objectContaining({ error: expect.any(String) }))
  })

  it('passes the limit through to the provider', async () => {
    const search = vi.fn(async (_q: string, limit: number) => Array.from({ length: limit }, (_, index) => hit(String(index))))
    registerSearchProvider({ domain: 'x', label: 'X', search })

    const groups = await searchAll('a', 3)

    expect(search).toHaveBeenCalledWith('a', 3)
    expect(groups[0]!.hits).toHaveLength(3)
  })
})
