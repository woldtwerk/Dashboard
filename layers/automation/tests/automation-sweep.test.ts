import { describe, expect, it, vi } from 'vitest'
import { sweepAll, sweepService } from '../server/utils/automation-sweep'
import type { SweepDeps, SweepTick } from '../server/utils/automation-sweep'
import type { AutomationDomain, AutomationItem } from '../shared/types/automation'

function item(key: string): AutomationItem {
  return { domain: 'documents', service: 'doc-1', key, documentId: Number(key), fields: {}, state: '', title: `Doc ${key}` }
}

const passLock = <T>(_name: string, _ttl: number, fn: () => Promise<T>) => fn()

function deps(overrides: Partial<SweepDeps> = {}): SweepDeps {
  return {
    services: async domain => domain === 'documents' ? ['doc-1'] : [],
    cursor: async () => null,
    setCursor: async () => {},
    load: async () => ({ items: [], cursor: null }),
    evaluate: async () => {},
    withLock: passLock,
    ...overrides
  }
}

describe('sweepService', () => {
  it('evaluates the loaded items and advances the cursor', async () => {
    const evaluate = vi.fn(async () => {})
    const setCursor = vi.fn(async () => {})
    const tick: SweepTick = { items: [item('1'), item('2')], cursor: '2026-10-18T09:00:00.000Z' }

    const result = await sweepService('documents', 'doc-1', deps({
      cursor: async () => '2026-10-18T08:00:00.000Z',
      load: async (_domain, _service, since) => {
        expect(since).toBe('2026-10-18T08:00:00.000Z')
        return tick
      },
      evaluate,
      setCursor
    }))

    expect(result).toEqual({ swept: 2, skipped: false })
    expect(evaluate).toHaveBeenCalledWith('documents', 'doc-1', tick.items)
    expect(setCursor).toHaveBeenCalledWith('documents', 'doc-1', '2026-10-18T09:00:00.000Z')
  })

  it('does nothing when the window is empty', async () => {
    const evaluate = vi.fn()
    const setCursor = vi.fn()

    const result = await sweepService('documents', 'doc-1', deps({
      load: async () => ({ items: [], cursor: 'unchanged' }),
      evaluate,
      setCursor
    }))

    expect(result).toEqual({ swept: 0, skipped: false })
    expect(evaluate).not.toHaveBeenCalled()
    expect(setCursor).not.toHaveBeenCalled()
  })

  it('does not write a cursor that did not move', async () => {
    const setCursor = vi.fn()
    await sweepService('documents', 'doc-1', deps({
      cursor: async () => '2026-10-18T09:00:00.000Z',
      load: async () => ({ items: [item('1')], cursor: '2026-10-18T09:00:00.000Z' }),
      setCursor
    }))

    expect(setCursor).not.toHaveBeenCalled()
  })

  it('skips when another worker holds the lease', async () => {
    const evaluate = vi.fn()
    const result = await sweepService('documents', 'doc-1', deps({
      withLock: async () => undefined,
      evaluate
    }))

    expect(result).toEqual({ swept: 0, skipped: true })
    expect(evaluate).not.toHaveBeenCalled()
  })
})

describe('sweepAll', () => {
  it('sweeps documents before mail and totals each domain', async () => {
    const order: AutomationDomain[] = []
    const evaluate = vi.fn(async (domain: AutomationDomain) => {
      order.push(domain)
    })

    const totals = await sweepAll(deps({
      services: async domain => domain === 'documents' ? ['doc-1'] : ['mail-1'],
      load: async domain => ({ items: [item(domain === 'documents' ? '1' : 'mail')], cursor: `2026-10-18T09:00:00.000Z` }),
      evaluate
    }))

    expect(order).toEqual(['documents', 'mail'])
    expect(totals).toEqual({ documents: 1, mail: 1 })
  })

  it('logs one failing service and keeps sweeping the rest', async () => {
    const logger = { warn: vi.fn() }
    const evaluate = vi.fn(async () => {})

    const totals = await sweepAll(deps({
      services: async domain => domain === 'documents' ? ['broken', 'ok'] : [],
      load: async (_domain, service) => {
        if (service === 'broken') {
          throw new Error('paperless down')
        }
        return { items: [item('1')], cursor: '2026-10-18T09:00:00.000Z' }
      },
      evaluate,
      logger
    }))

    expect(totals.documents).toBe(1)
    expect(logger.warn).toHaveBeenCalledOnce()
  })

  it('survives a service list that fails', async () => {
    const logger = { warn: vi.fn() }
    const totals = await sweepAll(deps({
      services: async (domain) => {
        if (domain === 'documents') {
          throw new Error('down')
        }
        return []
      },
      logger
    }))

    expect(totals).toEqual({ documents: 0, mail: 0 })
    expect(logger.warn).toHaveBeenCalledOnce()
  })
})
