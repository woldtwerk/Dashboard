import { describe, expect, it } from 'vitest'
import type { ItemActionContext } from '../../core/app/utils/item-actions'
import type { AutomationWorkflow } from '../shared/types/automation'
import {
  formatWorkflowRunSummary,
  workflowActionLabel,
  workflowsForContexts
} from '../app/utils/workflow-actions'

function context(overrides: Partial<ItemActionContext> = {}): ItemActionContext {
  return { domain: 'mail', service: 'mail-1', ref: 'mail:mail-1:INBOX%2F1', item: {}, ...overrides }
}

function workflow(overrides: Partial<AutomationWorkflow> = {}): AutomationWorkflow {
  return {
    id: 'w1',
    name: 'Invoices',
    domain: 'mail',
    service: null,
    enabled: true,
    mode: 'suggest',
    position: 0,
    graph: { version: 1, nodes: [], edges: [] },
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    ...overrides
  }
}

describe('workflowsForContexts', () => {
  it('keeps the items domain, global workflows and those of their service, in position order', () => {
    const workflows = [
      workflow({ id: 'late', position: 2 }),
      workflow({ id: 'early', position: 1, service: 'mail-1' }),
      workflow({ id: 'other-service', service: 'mail-2' }),
      workflow({ id: 'documents', domain: 'documents' })
    ]

    expect(workflowsForContexts(workflows, [context()]).map(entry => entry.id)).toEqual(['early', 'late'])
  })

  it('matches a service of any target in a multi-service selection', () => {
    const workflows = [
      workflow({ id: 'one', service: 'mail-1' }),
      workflow({ id: 'two', service: 'mail-2' })
    ]

    expect(workflowsForContexts(workflows, [context(), context({ service: 'mail-2' })]).map(entry => entry.id)).toEqual(['one', 'two'])
  })

  it('is empty without a domain', () => {
    expect(workflowsForContexts([workflow()], [])).toEqual([])
  })
})

describe('workflowActionLabel', () => {
  it('marks a disabled workflow', () => {
    expect(workflowActionLabel({ name: 'Invoices', enabled: true })).toBe('Invoices')
    expect(workflowActionLabel({ name: 'Invoices', enabled: false })).toBe('Invoices (disabled)')
  })
})

describe('formatWorkflowRunSummary', () => {
  it('counts the outcomes that occurred in a stable order', () => {
    expect(formatWorkflowRunSummary([
      { outcome: 'applied' },
      { outcome: 'applied' },
      { outcome: 'review' },
      { outcome: 'failed' }
    ])).toBe('2 applied · 1 needs review · 1 failed')
  })

  it('uses the plural of a review and keeps suggestions apart', () => {
    expect(formatWorkflowRunSummary([
      { outcome: 'suggested' },
      { outcome: 'review' },
      { outcome: 'review' }
    ])).toBe('1 suggested · 2 need review')
  })

  it('says so when there was nothing to do', () => {
    expect(formatWorkflowRunSummary([])).toBe('Nothing to run')
  })
})
