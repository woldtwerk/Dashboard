import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationWorkflow } from '../shared/types/automation'
import { runAutomation, sweepAutomation } from '../server/utils/automation-runtime'
import { listWorkflows } from '../server/utils/workflows'
import { readSweepCursor } from '../server/utils/runs'
import { ensureMailActivation } from '../server/utils/automation-activation'
import { loadMailSince } from '../server/utils/automation-items'

vi.mock('../server/utils/workflows', async importOriginal => ({
  ...await importOriginal<typeof import('../server/utils/workflows')>(),
  listWorkflows: vi.fn(),
  getWorkflow: vi.fn()
}))
vi.mock('../server/utils/runs', async importOriginal => ({
  ...await importOriginal<typeof import('../server/utils/runs')>(),
  readSweepCursor: vi.fn(),
  writeSweepCursor: vi.fn()
}))
vi.mock('../server/utils/automation-activation', () => ({ ensureMailActivation: vi.fn() }))
vi.mock('../server/utils/automation-items', async importOriginal => ({
  ...await importOriginal<typeof import('../server/utils/automation-items')>(),
  loadMailSince: vi.fn(),
  loadDocumentsSince: vi.fn()
}))

function workflow(domain: 'mail' | 'documents', service: string | null): AutomationWorkflow {
  return {
    id: `${domain}:${service ?? 'all'}`,
    name: 'Workflow',
    domain,
    service,
    enabled: true,
    mode: 'suggest',
    position: 0,
    graph: { version: 1, nodes: [], edges: [] },
    createdAt: '2026-10-18T09:00:00.000Z',
    updatedAt: '2026-10-18T09:00:00.000Z'
  }
}

const listed = vi.mocked(listWorkflows)
const ensureMail = vi.mocked(ensureMailActivation)
const mailSince = vi.mocked(loadMailSince)

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('listServices', async (domain: string) => domain === 'mail' ? [{ id: 'mail-1' }, { id: 'mail-2' }] : [])
  vi.stubGlobal('useServiceLogger', () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }))
  vi.stubGlobal('withLock', async (_name: string, _ttl: number, fn: (handle: unknown) => Promise<unknown>) => await fn({ renew: async () => true }))
  vi.mocked(readSweepCursor).mockResolvedValue(null)
  mailSince.mockResolvedValue({ items: [], cursor: null })
})

// A service no mail workflow covers must not record an activation: the insert-only
// watermark would otherwise stay stale until a workflow for that service exists.
describe('runAutomation', () => {
  it('does not touch a mail service that only another service\'s workflow covers', async () => {
    listed.mockResolvedValue([workflow('mail', 'mail-1')])

    await expect(runAutomation('mail', 'mail-2')).resolves.toEqual([])

    expect(ensureMail).not.toHaveBeenCalled()
  })
})

describe('sweepAutomation', () => {
  it('watches only the mail services an enabled workflow covers', async () => {
    listed.mockResolvedValue([workflow('mail', 'mail-1')])

    await sweepAutomation()

    expect(ensureMail.mock.calls).toEqual([['mail-1']])
    expect(mailSince).toHaveBeenCalledOnce()
  })
})
