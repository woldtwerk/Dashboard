import { describe, expect, it } from 'vitest'
import { actionIcon, actionSummary, attachmentLabel, availableVariables, decisionChainLabel, decisionSourceLabel, driveSaveSummary, nodeSubtitle, nodeTitle, outputLabel } from '../app/utils/workflow-view'
import type { AppliedAction, AutomationAction, WorkflowGraph, WorkflowNode, WorkflowPathStep } from '../shared/types/automation'

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

describe('driveSaveSummary', () => {
  it.each<{ branch: string, applied: AppliedAction[], expected: ReturnType<typeof driveSaveSummary> }>([
    {
      branch: 'a record with saved and skipped files',
      applied: [{
        type: 'save-to-drive',
        service: 'drive-1',
        paths: ['/my-files/Public/a.pdf'],
        skipped: [{ name: 'b.pdf', reason: 'duplicate' }, { name: 'c.pdf', reason: 'exists' }],
        matched: 3
      }],
      expected: [{ saved: 1, duplicate: 1, exists: 1, matched: 3 }]
    },
    {
      branch: 'a record that matched nothing',
      applied: [{ type: 'save-to-drive', service: 'drive-1', paths: [], skipped: [], matched: 0 }],
      expected: [{ saved: 0, duplicate: 0, exists: 0, matched: 0 }]
    },
    {
      branch: 'a record stored before skipped and matched existed',
      applied: [{ type: 'save-to-drive', service: 'drive-1', paths: ['/my-files/Public/a.pdf'] }],
      expected: [{ saved: 1, duplicate: 0, exists: 0, matched: undefined }]
    }
  ])('summarises $branch', ({ applied, expected }) => {
    expect(driveSaveSummary(applied)).toEqual(expected)
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

  it('summarises a save-to-drive node by its file types and folder', () => {
    const node = actionNode({ type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public/salsa', accept: ['video/*'] })
    expect(actionSummary(node.data.action)).toBe('Save videos to /my-files/Public/salsa')
    expect(actionIcon(node.data.action)).toBe('i-lucide-hard-drive-upload')
    expect(nodeTitle(node)).toBe('Save videos to /my-files/Public/salsa')
    expect(nodeSubtitle(node)).toBe('videos → /my-files/Public/salsa')
  })

  it('reads a save-to-drive without a folder or file filter', () => {
    const node = actionNode({ type: 'save-to-drive', service: 'drive-1', folder: '' })
    expect(actionSummary(node.data.action)).toBe('Save attachments to the drive')
    expect(nodeSubtitle(node)).toBe('Choose a drive folder')
  })

  it('says so when a save-to-drive node skips the duplicate check', () => {
    const node = actionNode({ type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', checkDuplicates: false })
    expect(actionSummary(node.data.action)).toBe('Save attachments to /my-files/Public, no duplicate check')
  })

  it('names a mixed or custom file filter as files', () => {
    expect(attachmentLabel(['video/*', 'image/*'])).toBe('files')
    expect(attachmentLabel(['text/csv'])).toBe('files')
    expect(attachmentLabel(['application/pdf'])).toBe('PDFs')
    expect(attachmentLabel(['image/*'])).toBe('images')
    expect(attachmentLabel()).toBe('attachments')
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
