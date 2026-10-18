import { describe, expect, it } from 'vitest'
import {
  addWorkflowNode,
  canRedoWorkflow,
  canUndoWorkflow,
  commitWorkflow,
  connectWorkflowNodes,
  createWorkflowHistory,
  findWorkflowNode,
  moveWorkflowNode,
  nextNodeId,
  pathEdges,
  pruneWorkflowEdges,
  removeWorkflowEdge,
  removeWorkflowNode,
  redoWorkflow,
  undoWorkflow,
  updateWorkflowNode,
  WORKFLOW_HISTORY_LIMIT
} from '../app/utils/workflow-edit'
import { createDefaultGraph } from '../shared/workflow'
import type { WorkflowGraph } from '../shared/types/automation'

function base(): WorkflowGraph {
  return createDefaultGraph('mail')
}

describe('workflow history', () => {
  it('undoes and redoes a committed graph', () => {
    const first = base()
    const history = commitWorkflow(createWorkflowHistory(first), addWorkflowNode(first, { id: 'c', type: 'condition', position: { x: 10, y: 10 }, data: { conditions: { combine: 'all', conditions: [] } } }))

    expect(canUndoWorkflow(history)).toBe(true)
    expect(history.present.nodes).toHaveLength(3)

    const undone = undoWorkflow(history)
    expect(undone.present).toEqual(first)
    expect(canRedoWorkflow(undone)).toBe(true)

    const redone = redoWorkflow(undone)
    expect(redone.present).toEqual(history.present)
  })

  it('does not record an unchanged graph', () => {
    const history = createWorkflowHistory(base())
    expect(commitWorkflow(history, base())).toBe(history)
  })

  it('drops the redo stack on a new edit', () => {
    const first = base()
    const edited = addWorkflowNode(first, { id: 'c', type: 'condition', position: { x: 10, y: 10 }, data: { conditions: { combine: 'all', conditions: [] } } })
    const undone = undoWorkflow(commitWorkflow(createWorkflowHistory(first), edited))
    const next = commitWorkflow(undone, addWorkflowNode(undone.present, { id: 'e', type: 'end', position: { x: 0, y: 0 }, data: {} }))

    expect(canRedoWorkflow(next)).toBe(false)
  })

  it('caps the past', () => {
    let history = createWorkflowHistory(base())
    for (let index = 0; index < WORKFLOW_HISTORY_LIMIT + 5; index++) {
      history = commitWorkflow(history, moveWorkflowNode(history.present, 'end', { x: index, y: 0 }))
    }
    expect(history.past).toHaveLength(WORKFLOW_HISTORY_LIMIT)
  })
})

describe('graph edits', () => {
  it('removes a node together with its edges', () => {
    const graph = removeWorkflowNode(base(), 'trigger')
    expect(graph.nodes.map(node => node.id)).toEqual(['end'])
    expect(graph.edges).toEqual([])
  })

  it('adds and updates a node', () => {
    const added = addWorkflowNode(base(), { id: 'c', type: 'condition', position: { x: 1, y: 2 }, data: { conditions: { combine: 'all', conditions: [] } } })
    const updated = updateWorkflowNode(added, 'c', { position: { x: 5, y: 6 } })
    expect(findWorkflowNode(updated, 'c')!.position).toEqual({ x: 5, y: 6 })
  })

  it('moves a node', () => {
    expect(findWorkflowNode(moveWorkflowNode(base(), 'trigger', { x: 42, y: 43 }), 'trigger')!.position).toEqual({ x: 42, y: 43 })
  })

  it('replaces an output edge when it is connected again', () => {
    const graph = addWorkflowNode(base(), { id: 'condition-1', type: 'condition', position: { x: 1, y: 1 }, data: { conditions: { combine: 'all', conditions: [] } } })
    const connected = connectWorkflowNodes(graph, { source: 'trigger', sourceHandle: 'next', target: 'condition-1' })

    expect(connected.edges).toHaveLength(1)
    expect(connected.edges[0]).toMatchObject({ source: 'trigger', sourceHandle: 'next', target: 'condition-1' })
  })

  it('ignores an incomplete connection', () => {
    expect(connectWorkflowNodes(base(), { source: 'trigger', sourceHandle: 'next' })).toEqual(base())
  })

  it('removes an edge', () => {
    expect(removeWorkflowEdge(base(), 'trigger-end').edges).toEqual([])
  })

  it('prunes an edge whose output handle disappeared', () => {
    const graph = addWorkflowNode(
      connectWorkflowNodes(base(), { source: 'trigger', sourceHandle: 'next', target: 'condition-1' }),
      { id: 'condition-1', type: 'decision', position: { x: 1, y: 1 }, data: { question: 'choice', instructions: 'kind?', options: { invoice: 'x' }, thresholds: { invoice: 0.8 } } }
    )
    const withStaleEdge = { ...graph, edges: [...graph.edges, { id: 'stale', source: 'condition-1', sourceHandle: 'removed', target: 'end' }] }
    expect(pruneWorkflowEdges(withStaleEdge).edges.map(edge => edge.id)).toEqual(['trigger-next-condition-1'])
  })

  it('generates the next free node id', () => {
    expect(nextNodeId(base(), 'condition')).toBe('condition-1')
    const graph = addWorkflowNode(base(), { id: 'condition-1', type: 'condition', position: { x: 0, y: 0 }, data: { conditions: { combine: 'all', conditions: [] } } })
    expect(nextNodeId(graph, 'condition')).toBe('condition-2')
  })

  it('maps a walked path to its edge ids', () => {
    expect(pathEdges(base(), [{ nodeId: 'trigger', output: 'next' }])).toEqual(['trigger-end'])
  })
})
