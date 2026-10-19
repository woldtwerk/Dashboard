import { describe, expect, it, vi } from 'vitest'
import type { ContextMenuItem } from '@nuxt/ui'
import { mailContextMenuItems, mailItemContext, type MailContextMenuHandlers } from '../app/utils/mail-context-menu'

function handlers(): MailContextMenuHandlers {
  return {
    open: vi.fn(),
    compose: vi.fn(),
    toggleUnread: vi.fn(),
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
      ['Mark as unread'],
      ['Delete']
    ])
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
      ['Mark as unread']
    ])
  })

  it('shows the shortcuts on the answer and delete entries', () => {
    const groups = mailContextMenuItems({ unread: false }, { permanent: false }, handlers())

    expect(groups[1]!.map(item => item.kbds)).toEqual([['r'], ['a'], ['f']])
    expect(groups[3]![0]!.kbds).toEqual(['#'])
  })

  it('leaves the shortcuts off when the view does not have them', () => {
    const groups = mailContextMenuItems({ unread: false }, { permanent: false, kbds: false }, handlers())

    expect(groups.flat().every(item => item.kbds === undefined)).toBe(true)
    expect(labels(groups)).toEqual([
      ['Open'],
      ['Reply', 'Reply all', 'Forward'],
      ['Mark as unread'],
      ['Delete']
    ])
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
    expect(on.delete).toHaveBeenCalledOnce()
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
