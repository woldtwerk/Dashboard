import { describe, expect, it } from 'vitest'
import { ACTION_TYPES, GENERIC_ACTION_TYPES } from '../shared/automation'
import { DOCUMENT_ACTIONS, MAIL_ACTIONS } from '../shared/workflow'
import { MAX_EXTRACT_PATTERN_LENGTH } from '../shared/extractors'
import { workflowTemplates } from '../shared/workflow-templates'
import { automationActionSchema, workflowGraphSchema, workflowPreviewSchema } from '../server/utils/workflows'
import type { AutomationAction, WorkflowGraph } from '../shared/types/automation'

/** The API boundary must accept a minimal, valid example of every action type */
const MINIMAL_ACTIONS: Record<AutomationAction['type'], AutomationAction> = {
  'move-to': { type: 'move-to', folder: 'Archive' },
  'label': { type: 'label', label: 'Invoices' },
  'mark-read': { type: 'mark-read' },
  'star': { type: 'star' },
  'trash': { type: 'trash' },
  'add-tag': { type: 'add-tag', tag: 1 },
  'set-correspondent': { type: 'set-correspondent', correspondent: 1 },
  'set-type': { type: 'set-type', documentType: 1 },
  'extract': { type: 'extract', variable: 'code', extractor: 'login-code' },
  'notify': {
    type: 'notify',
    title: 'Login code from {{from}}',
    body: '{{subject}}',
    modal: { title: 'Login code', text: '{{code}}', copy: true, expiresInMinutes: 15 }
  },
  'save-to-drive': {
    type: 'save-to-drive',
    service: 'drive-1',
    folder: '/my-files/Attachments',
    accept: ['video/*'],
    conflict: 'rename'
  },
  'request-payment': {
    type: 'request-payment',
    payee: 'payee-1',
    amount: '{{amount}}',
    title: 'Spotify',
    shares: 6,
    payers: [{ name: 'Anna Müller', email: 'anna@example.com' }],
    send: true
  },
  'confirm-paypal-payment': {
    type: 'confirm-paypal-payment',
    payee: 'payee-1'
  }
}

/** A complete graph around one action, in the shape the builder sends */
function graphWithAction(action: AutomationAction): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
      { id: 'action', type: 'action', position: { x: 0, y: 50 }, data: { action } },
      { id: 'end', type: 'end', position: { x: 0, y: 100 }, data: {} }
    ],
    edges: [
      { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'action' },
      { id: 'e2', source: 'action', sourceHandle: 'next', target: 'end' }
    ]
  }
}

describe('automationActionSchema', () => {
  it('accepts a minimal example of every action type the engine knows', () => {
    for (const [type, action] of Object.entries(MINIMAL_ACTIONS)) {
      expect(automationActionSchema.safeParse(action).success, type).toBe(true)
    }
  })

  it('covers exactly the shared mail, document and generic action types', () => {
    const known = [...MAIL_ACTIONS, ...DOCUMENT_ACTIONS, ...GENERIC_ACTION_TYPES].sort()
    // ACTION_TYPES is compile-checked against the union; the test links it to the schema
    expect([...Object.keys(ACTION_TYPES)].sort()).toEqual([...Object.keys(MINIMAL_ACTIONS)].sort())
    expect(known).toEqual([...Object.keys(MINIMAL_ACTIONS)].sort())
  })

  it('fits every action type into a full graph', () => {
    for (const [type, action] of Object.entries(MINIMAL_ACTIONS)) {
      expect(workflowGraphSchema.safeParse(graphWithAction(action)).success, type).toBe(true)
    }
  })

  it('bounds an extract variable name and pattern like the shared validation', () => {
    const extract = (patch: Record<string, unknown>) => automationActionSchema.safeParse({
      type: 'extract',
      variable: 'code',
      extractor: 'regex',
      pattern: '(\\d+)',
      ...patch
    }).success

    expect(extract({ variable: 'Code' })).toBe(false)
    expect(extract({ variable: 'login-code' })).toBe(false)
    expect(extract({ pattern: 'x'.repeat(MAX_EXTRACT_PATTERN_LENGTH + 1) })).toBe(false)
    expect(extract({ extractor: 'nope' })).toBe(false)
    expect(extract({ source: 'body' })).toBe(false)
    expect(extract({})).toBe(true)
  })

  it('bounds a notification modal expiry and title length', () => {
    const notify = (patch: Record<string, unknown>) => automationActionSchema.safeParse({
      type: 'notify',
      title: 'Hi',
      ...patch
    }).success

    expect(notify({})).toBe(true)
    expect(notify({ title: '' })).toBe(true)
    expect(notify({ title: 'x'.repeat(301) })).toBe(false)
    expect(notify({ modal: { text: 'x', expiresInMinutes: 0 } })).toBe(false)
    expect(notify({ modal: { text: 'x', expiresInMinutes: 1441 } })).toBe(false)
    expect(notify({ modal: { text: 'x', expiresInMinutes: 1440 } })).toBe(true)
    expect(notify({ modal: { text: 'x' } })).toBe(true)
  })

  it('bounds the save-to-drive folder, service and media types', () => {
    const save = (patch: Record<string, unknown>) => automationActionSchema.safeParse({
      type: 'save-to-drive',
      service: 'drive-1',
      folder: '/my-files/Attachments',
      ...patch
    }).success

    expect(save({})).toBe(true)
    expect(save({ folder: '/my-files/Public/salsa', accept: ['video/*', 'application/pdf'], conflict: 'skip' })).toBe(true)
    expect(save({ folder: 'Public/salsa' })).toBe(true)
    expect(save({ checkDuplicates: false })).toBe(true)
    expect(save({ service: '' })).toBe(false)
    expect(save({ folder: 'my-files/Attachments' })).toBe(true)
    expect(save({ folder: '/trash/old' })).toBe(false)
    expect(save({ folder: '/my-files/../etc' })).toBe(false)
    expect(save({ folder: '' })).toBe(false)
    expect(save({ accept: ['video'] })).toBe(false)
    expect(save({ accept: ['VIDEO/*'] })).toBe(true)
    expect(save({ accept: ['video/mp4', 'image/*'] })).toBe(true)
    expect(save({ conflict: 'overwrite' })).toBe(false)
  })

  it('defaults the save-to-drive duplicate check on', () => {
    const parsed = automationActionSchema.parse({
      type: 'save-to-drive',
      service: 'drive-1',
      folder: '/my-files/Attachments'
    })

    expect(parsed).toMatchObject({ checkDuplicates: true })
  })
})

describe('workflowGraphSchema', () => {
  it('parses a decision node with its fallback chain', () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
        {
          id: 'kind',
          type: 'decision',
          position: { x: 0, y: 50 },
          data: { question: 'yesno', instructions: 'Is this urgent?', thresholds: { yes: 0.9, no: 0.9 }, fallbacks: [{ type: 'ai', model: 'svc:gpt' }, { type: 'human' }] }
        },
        { id: 'end', type: 'end', position: { x: 0, y: 100 }, data: {} }
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'kind' },
        { id: 'e2', source: 'kind', sourceHandle: 'yes', target: 'end' }
      ]
    }

    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
  })

  it('parses a condition node with a half-typed row whose value is empty', () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
        {
          id: 'filter',
          type: 'condition',
          position: { x: 0, y: 50 },
          data: { conditions: { combine: 'all', conditions: [
            { field: 'subject', op: 'contains', value: 'invoice' },
            { field: 'from', op: 'contains', value: '' }
          ] } }
        },
        { id: 'end', type: 'end', position: { x: 0, y: 100 }, data: {} }
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'filter' },
        { id: 'e2', source: 'filter', sourceHandle: 'true', target: 'end' }
      ]
    }

    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
  })
})

describe('workflow templates parse at the API boundary', () => {
  it.each(workflowTemplates.map(template => [template.id, template] as const))(
    'parses %s with workflowGraphSchema and workflowPreviewSchema',
    (_id, template) => {
      if (template.requiresSetup) {
        // Deliberately incomplete until the user picks its required values
        expect(workflowGraphSchema.safeParse(template.graph).success).toBe(false)
        return
      }
      expect(workflowGraphSchema.safeParse(template.graph).success).toBe(true)
      expect(workflowPreviewSchema.safeParse({
        graph: template.graph,
        domain: template.domain,
        service: null,
        source: { kind: 'text', text: 'How does this graph read?' }
      }).success).toBe(true)
    }
  )
})
