import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetupValues } from '../../core/shared/types/setup'
import { createProtonMailProvider } from '../server/proton/provider'
import { isMailboxExistsError } from '../server/proton/bridge'

// The provider drives ImapFlow directly; the test hands it a fake client. A
// function returning the fake keeps `new ImapFlow(...)` working.
function fakeClient() {
  return {
    connect: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    mailboxCreate: vi.fn(async () => ({ created: true }))
  }
}

type FakeClient = ReturnType<typeof fakeClient>

const state = vi.hoisted(() => ({ client: undefined as unknown as FakeClient }))
vi.mock('imapflow', () => ({
  ImapFlow: function ImapFlow() {
    return state.client
  }
}))

function values(): SetupValues {
  return { host: '127.0.0.1', port: 1143, user: 'alice@proton.me', password: 'bridge-generated', allowSelfSigned: false }
}

beforeEach(() => {
  state.client = fakeClient()
})

describe('createMailbox', () => {
  it('creates the label folder', async () => {
    await createProtonMailProvider(values()).createMailbox!('Labels/Invoices')

    expect(state.client.mailboxCreate).toHaveBeenCalledWith('Labels/Invoices')
    // The connection is closed again
    expect(state.client.logout).toHaveBeenCalledOnce()
  })

  it('treats an existing folder as success', async () => {
    state.client.mailboxCreate.mockRejectedValueOnce(Object.assign(new Error('Mailbox already exists'), { response: 'NO Mailbox already exists' }))

    await expect(createProtonMailProvider(values()).createMailbox!('Labels/Invoices')).resolves.toBeUndefined()
  })

  it('recognises an RFC 5530 ALREADYEXISTS response code', async () => {
    state.client.mailboxCreate.mockRejectedValueOnce(Object.assign(new Error('CREATE failed'), { serverResponseCode: 'ALREADYEXISTS' }))

    await expect(createProtonMailProvider(values()).createMailbox!('Labels/Invoices')).resolves.toBeUndefined()
  })

  it('reports a real failure', async () => {
    state.client.mailboxCreate.mockRejectedValueOnce(Object.assign(new Error('Permission denied'), { response: 'NO Permission denied' }))

    await expect(createProtonMailProvider(values()).createMailbox!('Labels/Invoices')).rejects.toThrow('Permission denied')
  })
})

describe('isMailboxExistsError', () => {
  it('reads the code and the message', () => {
    expect(isMailboxExistsError({ serverResponseCode: 'ALREADYEXISTS' })).toBe(true)
    expect(isMailboxExistsError({ response: 'NO Mailbox already exists' })).toBe(true)
    expect(isMailboxExistsError({ message: 'mailbox already exists' })).toBe(true)
    expect(isMailboxExistsError({ response: 'NO Permission denied' })).toBe(false)
    expect(isMailboxExistsError(undefined)).toBe(false)
  })
})
