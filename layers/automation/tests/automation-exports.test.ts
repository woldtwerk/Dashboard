import { beforeEach, describe, expect, it } from 'vitest'
import {
  automationExport,
  automationExports,
  formatAutomationExportSummary,
  registerAutomationExport,
  resetAutomationExports
} from '../app/utils/automation-exports'

beforeEach(() => {
  resetAutomationExports()
})

describe('the automation export registry', () => {
  it('lists the registered exports in order', () => {
    registerAutomationExport({ id: 'one', label: 'One', icon: 'i-lucide-one', to: '/one' })
    registerAutomationExport({ id: 'two', label: 'Two', icon: 'i-lucide-two', to: '/two' })

    expect(automationExports().map(entry => entry.id)).toEqual(['one', 'two'])
  })

  it('replaces an entry with the same id', () => {
    registerAutomationExport({ id: 'one', label: 'Old', icon: 'i-lucide-one', to: '/old' })
    registerAutomationExport({ id: 'one', label: 'New', icon: 'i-lucide-two', to: '/new' })

    expect(automationExports()).toEqual([{ id: 'one', label: 'New', icon: 'i-lucide-two', to: '/new' }])
    expect(automationExport('one')?.label).toBe('New')
  })

  it('finds nothing for an unregistered id', () => {
    expect(automationExport('missing')).toBeUndefined()
  })
})

describe('formatAutomationExportSummary', () => {
  it('names the row count and the non-zero labels', () => {
    expect(formatAutomationExportSummary({
      rows: 3,
      labels: { human: 2, confirmed: 1, rejected: 0, ai: 0 }
    })).toBe('3 rows · 2 human, 1 confirmed')
  })

  it('shows only the row count without labels', () => {
    expect(formatAutomationExportSummary({ rows: 1 })).toBe('1 row')
  })
})
