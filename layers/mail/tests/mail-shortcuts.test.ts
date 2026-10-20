import { describe, expect, it, vi } from 'vitest'
import type { ContextMenuItem } from '@nuxt/ui'
import type { MailConversation, MailSummary } from '../shared/types/mail'
import {
  MAIL_SHORTCUT_KEYS,
  mailReplyTarget,
  mailShortcutTarget,
  type MailShortcutAction,
  type MailShortcutState,
  type MailShortcutTarget
} from '../app/utils/mail-shortcuts'
import {
  mailBatchContextMenuItems,
  mailContextMenuItems,
  type MailBatchContextMenuHandlers,
  type MailContextMenuHandlers
} from '../app/utils/mail-context-menu'

const mail = (uid: number, overrides: Partial<MailSummary> = {}): MailSummary => ({
  uid,
  mailbox: 'INBOX',
  subject: `Mail ${uid}`,
  from: [{ name: `Sender ${uid}`, address: `sender${uid}@example.com` }],
  date: '2026-10-20T10:00:00Z',
  unread: false,
  flagged: false,
  ...overrides
})

/** A conversation around its mails, oldest first */
const conversation = (mails: MailSummary[]): MailConversation => ({
  key: 'subject:hello',
  subject: 'Hello',
  participants: [],
  count: mails.length,
  unread: mails.some(item => item.unread),
  latest: mails.at(-1)!
})

const state = (overrides: Partial<MailShortcutState> = {}): MailShortcutState => ({
  view: 'mails',
  selectionCount: 0,
  selectedMail: null,
  openConversation: null,
  composerOpen: false,
  ...overrides
})

const onlyMail = mail(7)
const singleConversation = conversation([onlyMail])
const threadConversation = conversation([mail(1), mail(2), mail(3)])

describe('mailShortcutTarget', () => {
  const cases: [name: string, input: MailShortcutState, expected: MailShortcutTarget][] = [
    [
      'deletes the only mail of the open conversation',
      state({ view: 'conversations', openConversation: singleConversation }),
      { kind: 'conversation', key: singleConversation.key, mail: onlyMail }
    ],
    [
      'leaves a conversation with several mails alone',
      state({ view: 'conversations', openConversation: threadConversation }),
      null
    ],
    [
      'takes the conversation selection when there is one',
      state({ view: 'conversations', selectionCount: 2, openConversation: singleConversation }),
      { kind: 'batch' }
    ],
    [
      'takes the mail selection when there is one',
      state({ view: 'mails', selectionCount: 3, selectedMail: onlyMail }),
      { kind: 'batch' }
    ],
    [
      'deletes the open mail in the mails list',
      state({ view: 'mails', selectedMail: onlyMail }),
      { kind: 'mail', mail: onlyMail }
    ],
    ['has nothing to delete in the mails list', state({ view: 'mails' }), null],
    ['has nothing to delete without an open conversation', state({ view: 'conversations' }), null],
    [
      'leaves the composer alone',
      state({ view: 'conversations', selectionCount: 1, selectedMail: onlyMail, openConversation: singleConversation, composerOpen: true }),
      null
    ]
  ]

  it.each(cases)('%s', (_name, input, expected) => {
    expect(mailShortcutTarget(input)).toEqual(expected)
  })
})

describe('mailReplyTarget', () => {
  const own = { ownAddress: 'me@example.com' }
  const incoming = mail(1, { from: [{ address: 'alice@example.com' }], date: '2026-10-20T09:00:00Z' })
  const ownReply = mail(2, { from: [{ address: 'me@example.com' }], date: '2026-10-20T10:00:00Z' })

  const cases: [name: string, input: MailShortcutState, expected: MailSummary | null][] = [
    ['answers the open mail in the mails list', state({ view: 'mails', selectedMail: onlyMail }), onlyMail],
    ['has nothing to answer in the mails list', state({ view: 'mails' }), null],
    [
      'answers the newest mail the account did not send itself',
      state({
        view: 'conversations',
        openConversation: conversation([incoming, ownReply]),
        conversationMails: [incoming, ownReply],
        own
      }),
      incoming
    ],
    [
      'falls back to the newest mail when every mail is the account own',
      state({
        view: 'conversations',
        openConversation: conversation([ownReply]),
        conversationMails: [ownReply],
        own
      }),
      ownReply
    ],
    [
      'answers the newest mail while the conversation is not loaded',
      state({ view: 'conversations', openConversation: threadConversation }),
      threadConversation.latest
    ],
    ['has nothing to answer without an open conversation', state({ view: 'conversations' }), null],
    [
      'leaves the composer alone',
      state({ view: 'conversations', openConversation: singleConversation, composerOpen: true }),
      null
    ]
  ]

  it.each(cases)('%s', (_name, input, expected) => {
    expect(mailReplyTarget(input)).toEqual(expected)
  })
})

describe('context menu badges', () => {
  /** Which action a menu entry performs, by the label it renders */
  const ACTION_BY_LABEL: Record<string, MailShortcutAction> = {
    'Reply': 'reply',
    'Reply all': 'replyAll',
    'Forward': 'forward',
    'Delete': 'delete',
    'Delete forever': 'delete'
  }

  // The options the two lists really pass: a mail's menu and a conversation's
  const OPTIONS = [
    { permanent: false },
    { permanent: true },
    { permanent: false, deletable: false },
    { permanent: false, deletable: true },
    { permanent: true, deletable: false },
    { permanent: true, deletable: true }
  ]

  function handlers(): MailContextMenuHandlers {
    return { open: vi.fn(), compose: vi.fn(), toggleUnread: vi.fn(), delete: vi.fn() }
  }

  function batchHandlers(): MailBatchContextMenuHandlers {
    return { markRead: vi.fn(), markUnread: vi.fn(), delete: vi.fn() }
  }

  function badged(groups: ContextMenuItem[][]) {
    return groups.flat().flatMap(item => item.kbds
      ? [{ label: String(item.label), kbds: item.kbds.filter((key): key is string => typeof key === 'string') }]
      : [])
  }

  it('badges each action with exactly the keys the page binds', () => {
    const entries = [
      ...OPTIONS.flatMap(options => badged(mailContextMenuItems({ unread: false }, options, handlers()))),
      ...OPTIONS.flatMap(options => badged(mailBatchContextMenuItems('2 mails', options, batchHandlers())))
    ]

    expect(entries.length).toBeGreaterThan(0)

    const byAction = new Map<MailShortcutAction, Set<string>>()
    for (const entry of entries) {
      const action = ACTION_BY_LABEL[entry.label]
      expect(action, `no action for "${entry.label}"`).toBeDefined()
      byAction.set(action!, new Set([...(byAction.get(action!) ?? []), ...entry.kbds]))
    }

    for (const [action, keys] of byAction) {
      expect([...keys].sort()).toEqual([...MAIL_SHORTCUT_KEYS[action]].sort())
    }
    expect([...byAction.keys()].sort()).toEqual(Object.keys(MAIL_SHORTCUT_KEYS).sort())
  })
})
