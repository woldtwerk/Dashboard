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
