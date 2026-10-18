import { describe, expect, it } from 'vitest'
import { draftFromItem, firstSignificantWord } from '../shared/workflow-draft'
import { validateWorkflow } from '../shared/workflow'
import type { WorkflowGraph } from '../shared/types/automation'

function conditionOf(graph: WorkflowGraph) {
  const node = graph.nodes.find(candidate => candidate.type === 'condition')
  if (!node || node.type !== 'condition') {
    throw new Error('The draft has no condition')
  }
  return node.data.conditions.conditions[0]!
}

describe('firstSignificantWord', () => {
  it('skips stopwords and numbers', () => {
    expect(firstSignificantWord('Die Rechnung 2026')).toBe('Rechnung')
    expect(firstSignificantWord('2026 Rechnung')).toBe('Rechnung')
  })

  it('falls back to the first word when nothing is significant', () => {
    expect(firstSignificantWord('der die das')).toBe('der')
    expect(firstSignificantWord('42')).toBe('42')
  })
})

describe('draftFromItem mail', () => {
  it('builds a valid graph that tests the sender address', () => {
    const draft = draftFromItem('mail', {
      from: [{ name: 'Acme Billing', address: 'billing@acme.test' }],
      subject: 'Invoice 2026',
      mailbox: 'INBOX'
    })

    expect(draft.name).toBe('Mails from Acme Billing')
    expect(validateWorkflow(draft.graph, 'mail')).toEqual([])
    expect(draft.graph.nodes.map(node => node.type)).toEqual(['trigger', 'condition', 'action', 'end'])
    expect(conditionOf(draft.graph)).toEqual({ field: 'from', op: 'equals', value: 'billing@acme.test' })
    // The placeholder action is what the inspector opens on
    expect(draft.graph.nodes.find(node => node.type === 'action')).toMatchObject({ id: 'action-1', data: { action: { type: 'star' } } })
  })

  it('prefers the List-Id when the mail carries one', () => {
    const draft = draftFromItem('mail', {
      from: [{ address: 'news@example.com' }],
      subject: 'Issue 12',
      listId: 'news.example.com'
    })

    expect(conditionOf(draft.graph)).toEqual({ field: 'listId', op: 'equals', value: 'news.example.com' })
    expect(draft.name).toBe('Mails from news@example.com')
  })

  it('never adds a decision node on its own', () => {
    const draft = draftFromItem('mail', { from: [{ address: 'a@b.test' }] })
    expect(draft.graph.nodes.some(node => node.type === 'decision')).toBe(false)
  })
})

describe('draftFromItem documents', () => {
  it('tests the correspondent when the document has one', () => {
    const draft = draftFromItem('documents', { title: 'Rechnung 2026', correspondent: 'Acme' })

    expect(draft.name).toBe('Documents from Acme')
    expect(validateWorkflow(draft.graph, 'documents')).toEqual([])
    expect(conditionOf(draft.graph)).toEqual({ field: 'correspondent', op: 'equals', value: 'Acme' })
    expect(draft.graph.nodes.find(node => node.type === 'action')).toMatchObject({ data: { action: { type: 'add-tag' } } })
  })

  it('falls back to the first significant word of the title', () => {
    const draft = draftFromItem('documents', { title: 'Die Rechnung vom Amt' })

    expect(draft.name).toBe('Documents: Die Rechnung vom Amt')
    expect(conditionOf(draft.graph)).toEqual({ field: 'title', op: 'contains', value: 'Rechnung' })
  })

  it('wires the trigger through the condition into the action and the end', () => {
    const draft = draftFromItem('documents', { title: 'Vertrag' })
    expect(draft.graph.edges.map(edge => [edge.source, edge.sourceHandle, edge.target])).toEqual([
      ['trigger', 'next', 'condition-1'],
      ['condition-1', 'true', 'action-1'],
      ['condition-1', 'false', 'end'],
      ['action-1', 'next', 'end']
    ])
  })
})
