import type { AutomationAction, DecisionNodeData, WorkflowGraph, WorkflowNode } from '../../shared/types/automation'
import type { WorkflowValidationError } from '../../shared/workflow'

/** The data every custom Vue Flow node receives */
export interface FlowNodeData {
  node: WorkflowNode
  errors: string[]
  highlighted: boolean
  tone: 'primary' | 'info'
}

export const MAIL_TONE = 'primary' as const
export const DOCUMENTS_TONE = 'info' as const

export function domainTone(domain: 'mail' | 'documents') {
  return domain === 'mail' ? MAIL_TONE : DOCUMENTS_TONE
}

/** Keeps the validation errors next to the node they belong to */
export function errorsByNode(errors: WorkflowValidationError[]): Record<string, string[]> {
  const byNode: Record<string, string[]> = {}
  for (const error of errors) {
    if (error.nodeId) {
      byNode[error.nodeId] = [...(byNode[error.nodeId] ?? []), error.message]
    }
  }
  return byNode
}

export function toFlowNodes(graph: WorkflowGraph, errors: WorkflowValidationError[], highlighted: Set<string>, tone: 'primary' | 'info') {
  const byNode = errorsByNode(errors)

  return graph.nodes.map(node => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: { node, errors: byNode[node.id] ?? [], highlighted: highlighted.has(node.id), tone } satisfies FlowNodeData
  }))
}

/** A connection id links a node output to a node input; the highlight animation marks a preview path */
export function toFlowEdges(graph: WorkflowGraph, highlighted: Set<string>) {
  return graph.edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    animated: highlighted.has(edge.id),
    class: highlighted.has(edge.id) ? 'workflow-edge-active' : undefined
  }))
}

export function actionSummary(action: AutomationAction): string {
  switch (action.type) {
    case 'move-to':
      return `Move to ${action.folder}`
    case 'label':
      return `Label ${action.label}`
    case 'mark-read':
      return 'Mark as read'
    case 'star':
      return 'Star'
    case 'add-tag':
      return `Add tag #${action.tag}`
    case 'set-correspondent':
      return `Correspondent #${action.correspondent}`
    case 'set-type':
      return `Type #${action.documentType}`
  }
}

export function actionIcon(action: AutomationAction): string {
  switch (action.type) {
    case 'move-to':
      return 'i-lucide-folder-input'
    case 'label':
      return 'i-lucide-tag'
    case 'mark-read':
      return 'i-lucide-mail-open'
    case 'star':
      return 'i-lucide-star'
    case 'add-tag':
      return 'i-lucide-tag'
    case 'set-correspondent':
      return 'i-lucide-user'
    case 'set-type':
      return 'i-lucide-file-type'
  }
}

export function nodeTitle(node: WorkflowNode): string {
  switch (node.type) {
    case 'trigger':
      return 'New item'
    case 'condition':
      return 'Condition'
    case 'decision':
      return 'Ask Laya'
    case 'action':
      return actionSummary(node.data.action)
    case 'end':
      return 'End'
  }
}

export function nodeSubtitle(node: WorkflowNode): string {
  switch (node.type) {
    case 'trigger':
      return node.data.mailbox
    case 'condition': {
      const count = node.data.conditions.conditions.filter(condition => condition.value !== '').length
      return count ? `${count} condition${count === 1 ? '' : 's'}, ${node.data.conditions.combine}` : 'No conditions'
    }
    case 'decision':
      return node.data.instructions
    case 'action':
      return node.data.action.type
    case 'end':
      return 'Stop'
  }
}

/** The threshold shown on a choice output, e.g. `Rechnung ≥ 0.80` */
export function outputLabel(node: WorkflowNode, output: string): string {
  if (node.type === 'condition') {
    return output
  }
  if (node.type !== 'decision') {
    return output
  }

  const data: DecisionNodeData = node.data
  if (data.question === 'choice') {
    if (output === 'other') {
      return 'other'
    }
    return `${output} ≥ ${formatThreshold(data.thresholds[output] ?? 0)}`
  }

  if (output === 'yes') {
    return `yes ≥ ${formatThreshold(data.thresholds.yes)}`
  }
  if (output === 'no') {
    return `no ≥ ${formatThreshold(data.thresholds.no)}`
  }
  return 'unsure'
}

export function formatThreshold(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

export function outputLabels(node: WorkflowNode): string[] {
  if (node.type === 'trigger' || node.type === 'action') {
    return ['next']
  }
  if (node.type === 'condition') {
    return ['true', 'false']
  }
  if (node.type === 'decision') {
    return node.data.question === 'choice'
      ? [...Object.keys(node.data.options), 'other']
      : ['yes', 'no', 'unsure']
  }
  return []
}
