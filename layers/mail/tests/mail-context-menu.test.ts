import { describe, expect, it, vi } from 'vitest'
import type { ContextMenuItem } from '@nuxt/ui'
import { mailBatchContextMenuItems, mailContextMenuItems, mailItemContext, type MailBatchContextMenuHandlers, type MailContextMenuHandlers } from '../app/utils/mail-context-menu'
import { MAIL_SHORTCUT_KEYS } from '../app/utils/mail-shortcuts'

function handlers(): MailContextMenuHandlers {
  return {
    open: vi.fn(),
    compose: vi.fn(),
    toggleUnread: vi.fn(),
    toggleDone: vi.fn(),
    setLabel: vi.fn(),
    delete: vi.fn()
  }
}

function batchHandlers(): MailBatchContextMenuHandlers {
  return {
    markRead: vi.fn(),
    markUnread: vi.fn(),
    toggleDone: vi.fn(),
    setLabel: vi.fn(),
    delete: vi.fn()
  }
}

const labels = (groups: ContextMenuItem[][]) => groups.map(group => group.map(item => item.label))

describe('mailContextMenuItems', () => {
  it('groups open, answer, read state and delete', () => {
    const groups = mailContextMenuItems({ unread: false }, { permanent: false }, handlers())

    expect(labels(groups)).toEqual([
      ['Open'],
      ['Reply', 'Reply all', 'Forward'],
      ['Mark as unread', 'Mark as done'],
      ['Delete']
    ])
  })

  it('labels the done entry by the target state and offers the account labels', () => {
    const groups = mailContextMenuItems(
      { unread: false },
      {
        permanent: false,
        done: true,
        doneLabel: 'Done',
        labels: [{ label: 'Done', active: true }, { label: 'Invoices', active: false }]
      },
      handlers()
    )

    expect(labels(groups)[2]).toEqual(['Mark as unread', 'Mark as not done', 'Label'])
    expect(groups[2]![1]!.kbds).toEqual([...MAIL_SHORTCUT_KEYS.done])
    // The done label has its own entry, so the submenu holds the remaining labels
    const children = groups[2]![2]!.children as ContextMenuItem[]
    expect(children.map(item => item.label)).toEqual(['Invoices'])
    expect(children[0]?.checked).toBe(false)
  })

  it('offers "Mark as read" for an unread mail', () => {
    const groups = mailContextMenuItems({ unread: true }, { permanent: false }, handlers())

    expect(groups[2]![0]!.label).toBe('Mark as read')
    expect(groups[2]![0]!.icon).toBe('i-lucide-mail-open')
  })

  it('offers "Mark as unread" for a read mail', () => {
    const groups = mailContextMenuItems({ unread: false }, { permanent: false }, handlers())

    expect(groups[2]![0]!.label).toBe('Mark as unread')
    expect(groups[2]![0]!.icon).toBe('i-lucide-mail')
  })

  it('names a permanent delete and marks it as an error', () => {
    const groups = mailContextMenuItems({ unread: false }, { permanent: true }, handlers())

    expect(groups[3]![0]!.label).toBe('Delete forever')
    expect(groups[3]![0]!.color).toBe('error')
  })

  it('leaves the delete group out when it is not deletable', () => {
    const groups = mailContextMenuItems({ unread: false }, { permanent: false, deletable: false }, handlers())

    expect(labels(groups)).toEqual([
      ['Open'],
      ['Reply', 'Reply all', 'Forward'],
      ['Mark as unread', 'Mark as done']
    ])
  })

  it('shows the shortcuts the page binds on the answer, done and delete entries', () => {
    const groups = mailContextMenuItems({ unread: false }, { permanent: false }, handlers())

    expect(groups[1]!.map(item => item.kbds)).toEqual([
      [...MAIL_SHORTCUT_KEYS.reply],
      [...MAIL_SHORTCUT_KEYS.replyAll],
      [...MAIL_SHORTCUT_KEYS.forward]
    ])
    expect(groups[2]![1]!.kbds).toEqual([...MAIL_SHORTCUT_KEYS.done])
    expect(groups[3]![0]!.kbds).toEqual([...MAIL_SHORTCUT_KEYS.delete])
  })

  it('calls the matching handler for each entry', () => {
    const on = handlers()
    const groups = mailContextMenuItems({ unread: true }, { permanent: true }, on)

    for (const group of groups) {
      for (const item of group) {
        item.onSelect?.(new Event('select'))
      }
    }

    expect(on.open).toHaveBeenCalledOnce()
    expect(on.compose).toHaveBeenCalledWith('reply')
    expect(on.compose).toHaveBeenCalledWith('replyAll')
    expect(on.compose).toHaveBeenCalledWith('forward')
    expect(on.toggleUnread).toHaveBeenCalledOnce()
    expect(on.toggleDone).toHaveBeenCalledOnce()
    expect(on.delete).toHaveBeenCalledOnce()
  })

  it('toggles a label from the submenu', () => {
    const on = handlers()
    const groups = mailContextMenuItems(
      { unread: false },
      { permanent: false, labels: [{ label: 'Invoices', active: true }] },
      on
    )

    const children = groups[2]![2]!.children as ContextMenuItem[]
    children[0]?.onSelect?.(new Event('select'))

    expect(on.setLabel).toHaveBeenCalledWith('Invoices', false)
  })
})

describe('mailBatchContextMenuItems', () => {
  it('labels the count and offers both read states and delete', () => {
    const groups = mailBatchContextMenuItems('3 mails', { permanent: false }, batchHandlers())

    expect(labels(groups)).toEqual([
      ['3 mails'],
      ['Mark as read', 'Mark as unread', 'Mark as done'],
      ['Delete']
    ])
    expect(groups[0]![0]!.type).toBe('label')
  })

  it('names a permanent delete and marks it as an error', () => {
    const groups = mailBatchContextMenuItems('2 mails', { permanent: true }, batchHandlers())

    expect(groups[2]![0]!.label).toBe('Delete forever')
    expect(groups[2]![0]!.color).toBe('error')
  })

  it('leaves the delete group out when nothing can be deleted', () => {
    const groups = mailBatchContextMenuItems('2 conversations', { permanent: false, deletable: false }, batchHandlers())

    expect(labels(groups)).toEqual([
      ['2 conversations'],
      ['Mark as read', 'Mark as unread', 'Mark as done']
    ])
  })

  it('calls the matching handler for each entry', () => {
    const on = batchHandlers()
    const groups = mailBatchContextMenuItems('2 mails', { permanent: false }, on)

    for (const group of groups) {
      for (const item of group) {
        item.onSelect?.(new Event('select'))
      }
    }

    expect(on.markRead).toHaveBeenCalledOnce()
    expect(on.markUnread).toHaveBeenCalledOnce()
    expect(on.toggleDone).toHaveBeenCalledOnce()
    expect(on.delete).toHaveBeenCalledOnce()
  })

  it('marks several targets as not done when they all carry the label', () => {
    const groups = mailBatchContextMenuItems('2 mails', { permanent: false, done: true }, batchHandlers())

    expect(groups[1]![2]!.label).toBe('Mark as not done')
    expect(groups[1]![2]!.kbds).toEqual([...MAIL_SHORTCUT_KEYS.done])
  })
})

describe('mailItemContext', () => {
  it('describes the mail for other layers item actions', () => {
    const context = mailItemContext({
      uid: 7,
      mailbox: 'INBOX',
      subject: 'Hello',
      from: [{ address: 'alice@example.com' }],
      to: [{ address: 'bob@example.com' }],
      date: '2026-10-19T10:00:00Z',
      unread: false,
      flagged: false,
      listId: 'list.example',
      snippet: 'Hi'
    }, 'mail-1')

    expect(context).toEqual({
      domain: 'mail',
      service: 'mail-1',
      ref: 'mail:mail-1:INBOX%2F7',
      item: {
        from: [{ address: 'alice@example.com' }],
        to: [{ address: 'bob@example.com' }],
        subject: 'Hello',
        mailbox: 'INBOX',
        listId: 'list.example',
        snippet: 'Hi'
      }
    })
  })
})
