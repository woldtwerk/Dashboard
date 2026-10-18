import type { WorkflowGraph, WorkflowNode } from '../../shared/types/automation'
import { nodeOutputs } from '../../shared/workflow'

/** How many graph edits the editor can undo */
export const WORKFLOW_HISTORY_LIMIT = 50

export interface WorkflowHistory {
  past: WorkflowGraph[]
  present: WorkflowGraph
  future: WorkflowGraph[]
}

export function createWorkflowHistory(present: WorkflowGraph): WorkflowHistory {
  return { past: [], present, future: [] }
}

/** Commits a new graph; an unchanged graph (e.g. a drag that ended where it began) is not a step */
export function commitWorkflow(history: WorkflowHistory, next: WorkflowGraph): WorkflowHistory {
  if (JSON.stringify(next) === JSON.stringify(history.present)) {
    return history
  }

  return {
    past: [...history.past, history.present].slice(-WORKFLOW_HISTORY_LIMIT),
    present: next,
    future: []
  }
}

export function undoWorkflow(history: WorkflowHistory): WorkflowHistory {
  const previous = history.past.at(-1)
  if (!previous) {
    return history
  }
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future]
  }
}

export function redoWorkflow(history: WorkflowHistory): WorkflowHistory {
  const next = history.future[0]
  if (!next) {
    return history
  }
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1)
  }
}

export const canUndoWorkflow = (history: WorkflowHistory) => history.past.length > 0
export const canRedoWorkflow = (history: WorkflowHistory) => history.future.length > 0

// --- Graph edits ----------------------------------------------------------

/** A node type's id prefix, e.g. `condition-1` */
export function nextNodeId(graph: WorkflowGraph, prefix: string): string {
  let index = 1
  while (graph.nodes.some(node => node.id === `${prefix}-${index}`)) {
    index++
  }
  return `${prefix}-${index}`
}

export function addWorkflowNode(graph: WorkflowGraph, node: WorkflowNode): WorkflowGraph {
  return { ...graph, nodes: [...graph.nodes, node] }
}

/** Removes a node and every edge that touched it */
export function removeWorkflowNode(graph: WorkflowGraph, nodeId: string): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter(node => node.id !== nodeId),
    edges: graph.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId)
  }
}

export function moveWorkflowNode(graph: WorkflowGraph, nodeId: string, position: { x: number, y: number }): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(node => node.id === nodeId ? { ...node, position } : node)
  }
}

export function updateWorkflowNode(graph: WorkflowGraph, nodeId: string, patch: Partial<WorkflowNode>): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(node => node.id === nodeId ? { ...node, ...patch } as WorkflowNode : node)
  }
}

/** What Vue Flow reports when two handles are connected */
export interface WorkflowConnection {
  source?: string | null
  sourceHandle?: string | null
  target?: string | null
}

/**
 * Adds an edge from one node output. An output can carry at most one edge, so a
 * second connection replaces the first; a connection without both ends is ignored.
 */
export function connectWorkflowNodes(graph: WorkflowGraph, connection: WorkflowConnection): WorkflowGraph {
  const { source, sourceHandle, target } = connection
  if (!source || !sourceHandle || !target) {
    return graph
  }

  const edges = graph.edges.filter(edge => !(edge.source === source && edge.sourceHandle === sourceHandle))
  return {
    ...graph,
    edges: [...edges, { id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target }]
  }
}

export function removeWorkflowEdge(graph: WorkflowGraph, edgeId: string): WorkflowGraph {
  return { ...graph, edges: graph.edges.filter(edge => edge.id !== edgeId) }
}

/** Drops edges whose output handle no longer exists, e.g. after an option was renamed */
export function pruneWorkflowEdges(graph: WorkflowGraph): WorkflowGraph {
  return {
    ...graph,
    edges: graph.edges.filter((edge) => {
      const source = graph.nodes.find(node => node.id === edge.source)
      return !!source && nodeOutputs(source).includes(edge.sourceHandle)
    })
  }
}

export const findWorkflowNode = (graph: WorkflowGraph, nodeId: string | null | undefined) =>
  graph.nodes.find(node => node.id === nodeId)

/** Whether an edge belongs to the path a preview walked */
export function pathEdges(graph: WorkflowGraph, path: Array<{ nodeId: string, output: string }>): string[] {
  return path.flatMap((step) => {
    const edge = graph.edges.find(candidate => candidate.source === step.nodeId && candidate.sourceHandle === step.output)
    return edge ? [edge.id] : []
  })
}
