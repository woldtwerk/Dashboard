import { describe, expect, it } from 'vitest'
import { actionIcon, actionSummary, availableVariables, decisionChainLabel, decisionSourceLabel, nodeSubtitle, nodeTitle, outputLabel } from '../app/utils/workflow-view'
import type { AutomationAction, WorkflowGraph, WorkflowNode, WorkflowPathStep } from '../shared/types/automation'

function decisionNode(): WorkflowNode {
  return {
    id: 'kind',
    type: 'decision',
    position: { x: 0, y: 0 },
    data: { question: 'yesno', instructions: 'Is this urgent?', thresholds: { yes: 0.85, no: 0.85 } }
  }
}

describe('decisionSourceLabel', () => {
  it('names the three sources', () => {
    expect(decisionSourceLabel('engine')).toBe('Laya')
    expect(decisionSourceLabel('ai')).toBe('AI')
    expect(decisionSourceLabel('human')).toBe('you')
  })
})

describe('decisionChainLabel', () => {
  it('reads the earlier attempts, then who answered', () => {
    const step: WorkflowPathStep = {
      nodeId: 'kind',
      output: 'yes',
      source: 'human',
      attempts: [
        { source: 'engine', output: 'unsure', answer: { yes: 0.5, confidence: 0.42 } },
        { source: 'ai', output: 'unsure', answer: { yes: 0.6, confidence: 0.55 } }
      ]
    }
    expect(decisionChainLabel(step)).toBe('Laya 0.42 → AI 0.55 → you')
  })

  it('names a paused review as a question for the user', () => {
    const step: WorkflowPathStep = {
      nodeId: 'kind',
      output: 'review',
      attempts: [{ source: 'engine', output: 'unsure', answer: { yes: 0.5, confidence: 0.42 } }]
    }
    expect(decisionChainLabel(step)).toBe('Laya 0.42 → you')
  })

  it('marks a fallback that could not run', () => {
    const step: WorkflowPathStep = {
      nodeId: 'kind',
      output: 'review',
      attempts: [
        { source: 'engine', output: 'unsure', answer: { yes: 0.5, confidence: 0.42 } },
        { source: 'ai', output: 'unsure', error: 'No AI service is set up' }
      ]
    }
    expect(decisionChainLabel(step)).toBe('Laya 0.42 → AI unavailable → you')
  })

  it('is empty when there is nothing to tell', () => {
    expect(decisionChainLabel({ output: 'yes' })).toBe('')
  })
})

describe('workflow-view labels', () => {
  it('titles and subtitles a decision node', () => {
    const node = decisionNode()
    expect(nodeTitle(node)).toBe('Ask Laya')
    expect(nodeSubtitle(node)).toBe('Is this urgent?')
  })

  it('shows a yes/no output with its threshold', () => {
    expect(outputLabel(decisionNode(), 'yes')).toBe('yes ≥ 0.85')
    expect(outputLabel(decisionNode(), 'unsure')).toBe('unsure')
  })
})

describe('generic action labels', () => {
  function actionNode(action: AutomationAction): Extract<WorkflowNode, { type: 'action' }> {
    return { id: 'a', type: 'action', position: { x: 0, y: 0 }, data: { action } }
  }

  it('summarises and titles an extract node', () => {
    const node = actionNode({ type: 'extract', variable: 'code', extractor: 'login-code' })
    expect(actionSummary(node.data.action)).toBe('Extract {{code}}')
    expect(actionIcon(node.data.action)).toBe('i-lucide-scan-text')
    expect(nodeTitle(node)).toBe('Extract {{code}}')
    expect(nodeSubtitle(node)).toBe('Login code → {{code}}')
  })

  it('summarises and titles a notify node', () => {
    const node = actionNode({ type: 'notify', title: 'Login code from {{from}}' })
    expect(actionSummary(node.data.action)).toBe('Send notification')
    expect(actionIcon(node.data.action)).toBe('i-lucide-bell')
    expect(nodeTitle(node)).toBe('Send notification')
    expect(nodeSubtitle(node)).toBe('Login code from {{from}}')
  })
})

describe('availableVariables', () => {
  function graph(nodes: WorkflowNode[]): WorkflowGraph {
    return { version: 1, nodes, edges: [] }
  }

  it('lists the built-ins plus every valid extract variable', () => {
    const variables = availableVariables(graph([
      { id: 'a', type: 'action', position: { x: 0, y: 0 }, data: { action: { type: 'extract', variable: 'code', extractor: 'login-code' } } },
      { id: 'b', type: 'action', position: { x: 0, y: 0 }, data: { action: { type: 'extract', variable: 'order', extractor: 'regex', pattern: '(\\d+)' } } }
    ]))

    expect(variables).toEqual(['title', 'subject', 'from', 'workflow', 'code', 'order'])
  })

  it('ignores an extract with an invalid variable name', () => {
    const variables = availableVariables(graph([
      { id: 'a', type: 'action', position: { x: 0, y: 0 }, data: { action: { type: 'extract', variable: 'Bad', extractor: 'login-code' } } }
    ]))

    expect(variables).toEqual(['title', 'subject', 'from', 'workflow'])
  })
})
