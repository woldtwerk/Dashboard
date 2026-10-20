import { describe, expect, it } from 'vitest'
import { validateWorkflow } from '../shared/workflow'
import { instantiateWorkflowTemplate, workflowTemplates } from '../shared/workflow-templates'
import type { WorkflowTemplate } from '../shared/workflow-templates'
import type { WorkflowGraph } from '../shared/types/automation'

function template(id: string): WorkflowTemplate {
  const found = workflowTemplates.find(entry => entry.id === id)
  if (!found) {
    throw new Error(`missing template ${id}`)
  }
  return found
}

/** The document ids an instantiated graph carries for one action type */
function numericActionIds(graph: WorkflowGraph, type: 'set-type' | 'add-tag'): number[] {
  const ids: number[] = []
  for (const node of graph.nodes) {
    if (node.type !== 'action') {
      continue
    }
    if (type === 'set-type' && node.data.action.type === 'set-type') {
      ids.push(node.data.action.documentType)
    }
    if (type === 'add-tag' && node.data.action.type === 'add-tag') {
      ids.push(node.data.action.tag)
    }
  }
  return ids
}

describe('workflowTemplates', () => {
  it('has unique ids', () => {
    expect(new Set(workflowTemplates.map(entry => entry.id)).size).toBe(workflowTemplates.length)
  })

  it('is a valid graph for its domain', () => {
    for (const entry of workflowTemplates) {
      if (entry.requiresSetup) {
        // Deliberately incomplete: it waits for the user to pick its required values
        expect(validateWorkflow(entry.graph, entry.domain), entry.id).not.toEqual([])
        continue
      }
      expect(validateWorkflow(entry.graph, entry.domain), entry.id).toEqual([])
    }
  })

  it('points every binding at an action node of its graph', () => {
    for (const entry of workflowTemplates) {
      for (const binding of entry.bindings) {
        const node = entry.graph.nodes.find(candidate => candidate.id === binding.nodeId)
        expect(node?.type, `${entry.id}:${binding.nodeId}`).toBe('action')
      }
    }
  })

  it('gives every choice question an explicit, described catch-all option', () => {
    for (const entry of workflowTemplates) {
      for (const node of entry.graph.nodes) {
        if (node.type !== 'decision' || node.data.question !== 'choice') {
          continue
        }
        const where = `${entry.id}:${node.id}`
        expect(Object.keys(node.data.options), where).toContain('other')
        expect(node.data.options.other, where).toBeTruthy()
        // Discriminative descriptions: the model reads these, not just the keys
        for (const [key, description] of Object.entries(node.data.options)) {
          expect(description.trim().length, `${where}:${key}`).toBeGreaterThan(10)
        }
      }
    }
  })
})

describe('instantiateWorkflowTemplate', () => {
  it('resolves document types and tags by name', () => {
    const { graph, errors } = instantiateWorkflowTemplate(template('documents-classify'), {
      tags: [{ id: 11, name: 'auto' }],
      documentTypes: [
        { id: 7, name: 'Invoice' },
        { id: 8, name: 'Contract' },
        { id: 9, name: 'Payslip' },
        { id: 10, name: 'Certificate' },
        { id: 12, name: 'Letter' }
      ]
    })

    expect(errors).toEqual([])
    expect(numericActionIds(graph, 'set-type')).toEqual([7, 8, 9, 10, 12])
    expect(numericActionIds(graph, 'add-tag')).toEqual([11])
    expect(validateWorkflow(graph, 'documents')).toEqual([])
  })

  it('treats a name case-insensitively', () => {
    const { errors } = instantiateWorkflowTemplate(template('documents-tax'), {
      tags: [{ id: 3, name: '  steuer ' }],
      documentTypes: []
    })
    expect(errors).toEqual([])
  })

  it('leaves an unresolved type as a validation error until one is picked', () => {
    const { graph, errors } = instantiateWorkflowTemplate(template('documents-classify'), {
      tags: [{ id: 11, name: 'auto' }],
      documentTypes: [{ id: 7, name: 'Invoice' }]
    })

    expect(errors.some(error => error.nodeId === 'type-contract' && error.message.includes('Contract'))).toBe(true)
    expect(validateWorkflow(graph, 'documents').some(error => error.nodeId === 'type-contract')).toBe(true)
    // The type that does exist is still resolved
    expect(numericActionIds(graph, 'set-type')).toContain(7)
  })

  it('leaves an unresolved tag as a validation error too', () => {
    const { graph, errors } = instantiateWorkflowTemplate(template('documents-tax'), { tags: [], documentTypes: [] })

    expect(errors).toHaveLength(1)
    expect(errors[0]!.nodeId).toBe('tag-tax')
    expect(validateWorkflow(graph, 'documents')).not.toEqual([])
  })

  it('leaves a template without bindings untouched', () => {
    const mail = template('mail-shipping')
    const { graph, errors } = instantiateWorkflowTemplate(mail, { tags: [], documentTypes: [] })

    expect(errors).toEqual([])
    expect(graph).toEqual(mail.graph)
  })
})

describe('login code template', () => {
  it('extracts the code, notifies with a pop-up and then trashes the mail, and says it is meant for automatic mode', () => {
    const entry = template('mail-login-codes')

    expect(entry.domain).toBe('mail')
    expect(validateWorkflow(entry.graph, 'mail')).toEqual([])

    const actions = entry.graph.nodes
      .filter(node => node.type === 'action')
      .map(node => node.data.action)
    expect(actions.map(action => action.type)).toEqual(['extract', 'notify', 'trash'])

    const extract = actions[0]!
    expect(extract).toMatchObject({ type: 'extract', variable: 'code', extractor: 'login-code' })

    const notify = actions[1]!
    expect(notify.type).toBe('notify')
    if (notify.type === 'notify') {
      expect(notify.title).toBe('Login code from {{from}}')
      expect(notify.body).toBe('{{subject}}')
      expect(notify.modal).toEqual({ title: 'Login code', text: '{{code}}', copy: true, expiresInMinutes: 15 })
    }

    expect(entry.description).toContain('automatic mode')
    expect(entry.icon).toBe('i-lucide-key-round')
  })
})

describe('attachments to drive template', () => {
  it('saves the attachments and trashes the mail, and waits for a drive service and folder', () => {
    const entry = template('mail-attachments-to-drive')

    expect(entry.domain).toBe('mail')
    expect(entry.requiresSetup).toBe(true)
    expect(entry.icon).toBe('i-lucide-hard-drive-upload')

    const actions = entry.graph.nodes
      .filter(node => node.type === 'action')
      .map(node => node.data.action)
    expect(actions.map(action => action.type)).toEqual(['save-to-drive', 'trash'])
    expect(actions[0]).toMatchObject({ type: 'save-to-drive', service: '', folder: '' })

    // A missing drive service and folder are what the user has to complete
    const errors = validateWorkflow(entry.graph, 'mail')
    expect(errors.map(error => error.message)).toEqual([
      'The save-to-drive action needs a drive service',
      'The save-to-drive action needs a folder'
    ])
  })
})
