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
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    mailboxCreate: vi.fn(async () => ({ created: true })),
    messageFlagsAdd: vi.fn(async () => {}),
    messageFlagsRemove: vi.fn(async () => {}),
    messageMove: vi.fn(async () => ({ uidMap: new Map<number, number>() })),
    messageDelete: vi.fn(async () => {}),
    fetchOne: vi.fn(async (): Promise<{ uid: number, source: Buffer } | null> => null)
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

describe('batch mail commands', () => {
  it('sets the seen flag for every uid with one command and one connection', async () => {
    const provider = createProtonMailProvider(values())

    await provider.setSeenMany('INBOX', [4, 7, 9], true)

    expect(state.client.connect).toHaveBeenCalledOnce()
    expect(state.client.messageFlagsAdd).toHaveBeenCalledOnce()
    expect(state.client.messageFlagsAdd).toHaveBeenCalledWith('4,7,9', ['\\Seen'], { uid: true })
  })

  it('delegates the single setSeen call to the batch command', async () => {
    const provider = createProtonMailProvider(values())

    await provider.setSeen('INBOX', 42, false)

    expect(state.client.messageFlagsRemove).toHaveBeenCalledOnce()
    expect(state.client.messageFlagsRemove).toHaveBeenCalledWith('42', ['\\Seen'], { uid: true })
  })

  it('moves every uid with one command and returns the uid map', async () => {
    const uidMap = new Map([[7, 100], [9, 101]])
    state.client.messageMove.mockResolvedValueOnce({ uidMap })
    const provider = createProtonMailProvider(values())

    await expect(provider.moveMessages('INBOX', [7, 9], 'Archive')).resolves.toEqual(uidMap)

    expect(state.client.messageMove).toHaveBeenCalledOnce()
    expect(state.client.messageMove).toHaveBeenCalledWith('7,9', 'Archive', { uid: true })
  })

  it('deletes every uid with one command and one connection', async () => {
    const provider = createProtonMailProvider(values())

    await provider.deleteMessages('Trash', [4, 7])

    expect(state.client.connect).toHaveBeenCalledOnce()
    expect(state.client.messageDelete).toHaveBeenCalledOnce()
    expect(state.client.messageDelete).toHaveBeenCalledWith('4,7', { uid: true })
  })
})

describe('getAttachments', () => {
  const source = [
    'From: Alice <alice@example.com>',
    'To: Bob <bob@example.com>',
    'Subject: Two files',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="BB"',
    '',
    '--BB',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hello',
    '--BB',
    'Content-Type: application/pdf',
    'Content-Disposition: attachment; filename="report.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'SGVsbG8=',
    '--BB',
    'Content-Type: image/png',
    'Content-Disposition: attachment',
    'Content-Transfer-Encoding: base64',
    '',
    'aGVsbG8=',
    '--BB--',
    ''
  ].join('\r\n')

  it('returns the bytes, type and size of every attachment', async () => {
    state.client.fetchOne.mockResolvedValueOnce({ uid: 7, source: Buffer.from(source) })

    const attachments = await createProtonMailProvider(values()).getAttachments!('INBOX', 7)

    expect(attachments.map(({ filename, contentType, size }) => ({ filename, contentType, size }))).toEqual([
      { filename: 'report.pdf', contentType: 'application/pdf', size: 5 },
      { filename: 'attachment-2.png', contentType: 'image/png', size: 5 }
    ])
    expect(Buffer.from(attachments[0]!.content).toString()).toBe('Hello')
    expect(state.client.fetchOne).toHaveBeenCalledWith('7', expect.objectContaining({ source: true }), { uid: true })
  })

  it('returns nothing for a message that is gone', async () => {
    state.client.fetchOne.mockResolvedValueOnce(null)

    await expect(createProtonMailProvider(values()).getAttachments!('INBOX', 7)).resolves.toEqual([])
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
