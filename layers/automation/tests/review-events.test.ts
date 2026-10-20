import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../shared/types/automation'
import { rejectSuggestion } from '../server/utils/automation-runtime'

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  updateRun: vi.fn(),
  publishReviewEvent: vi.fn()
}))

vi.mock('../server/utils/runs', () => ({
  getRun: mocks.getRun,
  updateRun: mocks.updateRun,
  dueItems: vi.fn(),
  markEvaluated: vi.fn(),
  readSweepCursor: vi.fn(),
  recordAttempt: vi.fn(),
  recordRun: vi.fn(),
  writeSweepCursor: vi.fn()
}))

vi.mock('../server/utils/automation-events', () => ({
  publishModalEvent: vi.fn(),
  publishReviewEvent: mocks.publishReviewEvent
}))

function run(outcome: AutomationRun['outcome']): AutomationRun {
  return {
    id: 'run-1',
    workflow: 'w1',
    workflowName: 'Invoices',
    domain: 'mail',
    service: 'mail-1',
    itemKey: 'INBOX|1|m1',
    item: { domain: 'mail', service: 'mail-1', key: 'INBOX|1|m1', mailbox: 'INBOX', uid: 1, unread: true, flagged: false, fields: {}, state: 'state', title: 'Invoice' },
    path: [],
    answers: {},
    outcome,
    actions: [],
    applied: [],
    at: '2026-10-18T10:00:00.000Z'
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateRun.mockImplementation(async (id: string, patch: Partial<AutomationRun>) => ({ ...run('skipped'), id, ...patch }))
})

describe('rejectSuggestion', () => {
  it('announces that a dismissed review no longer waits for a human', async () => {
    mocks.getRun.mockResolvedValue(run('review'))

    await rejectSuggestion('run-1')

    expect(mocks.publishReviewEvent).toHaveBeenCalledOnce()
    expect(mocks.publishReviewEvent.mock.calls[0]![0].outcome).toBe('skipped')
  })

  it('does not announce a rejected suggestion, which never waited for a review', async () => {
    mocks.getRun.mockResolvedValue(run('suggested'))

    await rejectSuggestion('run-1')

    expect(mocks.publishReviewEvent).not.toHaveBeenCalled()
  })
})
