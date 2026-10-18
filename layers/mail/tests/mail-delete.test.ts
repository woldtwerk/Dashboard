import { describe, expect, it, vi } from 'vitest'
import type { Mailbox } from '../shared/types/mail'
import { mailDocumentId } from '../server/mail-index/document'
import { deleteMail, moveMail } from '../server/utils/mail-delete'
import { trashTarget } from '../shared/mail-delete'

const mailbox = (path: string, specialUse?: string): Mailbox => ({
  path,
  name: path,
  specialUse,
  total: 0,
  unread: 0
})

const INBOX = mailbox('INBOX', '\\Inbox')
const TRASH = mailbox('Trash', '\\Trash')
const TRASH_BY_PATH = mailbox('Trash')

describe('trashTarget', () => {
  it('picks the mailbox marked with the trash special-use flag', () => {
    expect(trashTarget([INBOX, TRASH], 'INBOX')).toBe(TRASH)
  })

  it('falls back to a mailbox called "Trash" when no flag is reported', () => {
    expect(trashTarget([INBOX, TRASH_BY_PATH], 'INBOX')).toBe(TRASH_BY_PATH)
  })

  it('has no target when the current mailbox is the trash', () => {
    expect(trashTarget([INBOX, TRASH], 'Trash')).toBeUndefined()
  })

  it('has no target when the account has no trash folder', () => {
    expect(trashTarget([INBOX], 'INBOX')).toBeUndefined()
  })
})

describe('deleteMail', () => {
  it('moves to the trash outside it, updates the index and announces both mailboxes', async () => {
    const provider = {
      listMailboxes: vi.fn(async () => [INBOX, TRASH]),
      moveMessage: vi.fn(async () => ({ uid: 99 })),
      deleteMessage: vi.fn(async () => {})
    }
    const index = { remove: vi.fn(async () => {}) }
    const published: string[] = []
    const publish = vi.fn(async (box: string) => {
      published.push(box)
    })

    const outcome = await deleteMail('svc', 'INBOX', 42, {}, { provider, index, publish, logger: { warn: vi.fn() } })

    expect(outcome).toEqual({ action: 'trashed', trashMailbox: 'Trash', trashUid: 99 })
    expect(provider.moveMessage).toHaveBeenCalledWith('INBOX', 42, 'Trash')
    expect(provider.deleteMessage).not.toHaveBeenCalled()
    expect(index.remove).toHaveBeenCalledWith([mailDocumentId('svc', 'INBOX', 42)])
    expect(published).toEqual(['INBOX', 'Trash'])
  })

  it('still moves to the trash when permanent is set but a trash target exists', async () => {
    const provider = {
      listMailboxes: vi.fn(async () => [INBOX, TRASH]),
      moveMessage: vi.fn(async () => ({ uid: 99 })),
      deleteMessage: vi.fn(async () => {})
    }

    const outcome = await deleteMail('svc', 'INBOX', 42, { permanent: true }, { provider, publish: vi.fn(async () => {}), logger: { warn: vi.fn() } })

    expect(outcome).toEqual({ action: 'trashed', trashMailbox: 'Trash', trashUid: 99 })
    expect(provider.moveMessage).toHaveBeenCalledWith('INBOX', 42, 'Trash')
    expect(provider.deleteMessage).not.toHaveBeenCalled()
  })

  it('deletes permanently in the trash when permanent is set', async () => {
    const provider = {
      listMailboxes: vi.fn(async () => [INBOX, TRASH]),
      moveMessage: vi.fn(async () => ({})),
      deleteMessage: vi.fn(async () => {})
    }
    const index = { remove: vi.fn(async () => {}) }
    const published: string[] = []
    const publish = vi.fn(async (box: string) => {
      published.push(box)
    })

    const outcome = await deleteMail('svc', 'Trash', 7, { permanent: true }, { provider, index, publish, logger: { warn: vi.fn() } })

    expect(outcome).toEqual({ action: 'deleted' })
    expect(provider.deleteMessage).toHaveBeenCalledWith('Trash', 7)
    expect(provider.moveMessage).not.toHaveBeenCalled()
    expect(index.remove).toHaveBeenCalledWith([mailDocumentId('svc', 'Trash', 7)])
    expect(published).toEqual(['Trash'])
  })

  it('refuses a permanent delete in the trash when not confirmed', async () => {
    const provider = {
      listMailboxes: vi.fn(async () => [INBOX, TRASH]),
      moveMessage: vi.fn(async () => ({})),
      deleteMessage: vi.fn(async () => {})
    }

    await expect(deleteMail('svc', 'Trash', 7, {}, { provider, publish: vi.fn(async () => {}), logger: { warn: vi.fn() } }))
      .rejects.toMatchObject({ statusCode: 409 })

    expect(provider.deleteMessage).not.toHaveBeenCalled()
    expect(provider.moveMessage).not.toHaveBeenCalled()
  })

  it('deletes permanently when the account has no trash folder and permanent is set', async () => {
    const provider = {
      listMailboxes: vi.fn(async () => [INBOX]),
      moveMessage: vi.fn(async () => ({})),
      deleteMessage: vi.fn(async () => {})
    }

    const outcome = await deleteMail('svc', 'INBOX', 7, { permanent: true }, { provider, publish: vi.fn(async () => {}), logger: { warn: vi.fn() } })

    expect(outcome).toEqual({ action: 'deleted' })
    expect(provider.deleteMessage).toHaveBeenCalledWith('INBOX', 7)
  })

  it('refuses a permanent delete when the account has no trash folder and it is not confirmed', async () => {
    const provider = {
      listMailboxes: vi.fn(async () => [INBOX]),
      moveMessage: vi.fn(async () => ({})),
      deleteMessage: vi.fn(async () => {})
    }

    await expect(deleteMail('svc', 'INBOX', 7, {}, { provider, publish: vi.fn(async () => {}), logger: { warn: vi.fn() } }))
      .rejects.toMatchObject({ statusCode: 409 })

    expect(provider.deleteMessage).not.toHaveBeenCalled()
  })

  it('logs and swallows an index failure, still announcing the change', async () => {
    const provider = {
      listMailboxes: vi.fn(async () => [INBOX, TRASH]),
      moveMessage: vi.fn(async () => ({ uid: 99 })),
      deleteMessage: vi.fn(async () => {})
    }
    const index = {
      remove: vi.fn(async () => {
        throw new Error('meilisearch down')
      })
    }
    const publish = vi.fn(async () => {})
    const logger = { warn: vi.fn() }

    await expect(deleteMail('svc', 'INBOX', 42, {}, { provider, index, publish, logger })).resolves.toEqual({ action: 'trashed', trashMailbox: 'Trash', trashUid: 99 })

    expect(logger.warn).toHaveBeenCalledOnce()
    expect(logger.warn.mock.calls[0]?.[1]).toMatchObject({ error: 'meilisearch down' })
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('skips the index when none is registered', async () => {
    const provider = {
      listMailboxes: vi.fn(async () => [INBOX, TRASH]),
      moveMessage: vi.fn(async () => ({ uid: 99 })),
      deleteMessage: vi.fn(async () => {})
    }
    const publish = vi.fn(async () => {})
    const logger = { warn: vi.fn() }

    await deleteMail('svc', 'INBOX', 42, {}, { provider, publish, logger })

    expect(provider.moveMessage).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('moveMail', () => {
  it('returns the new UID, updates the index and announces both mailboxes', async () => {
    const provider = { moveMessage: vi.fn(async () => ({ uid: 42 })) }
    const index = { remove: vi.fn(async () => {}) }
    const published: string[] = []
    const publish = vi.fn(async (box: string) => {
      published.push(box)
    })

    const result = await moveMail('svc', 'Trash', 99, 'INBOX', { provider, index, publish, logger: { warn: vi.fn() } })

    expect(result).toEqual({ uid: 42 })
    expect(provider.moveMessage).toHaveBeenCalledWith('Trash', 99, 'INBOX')
    expect(index.remove).toHaveBeenCalledWith([mailDocumentId('svc', 'Trash', 99)])
    expect(published).toEqual(['Trash', 'INBOX'])
  })
})
