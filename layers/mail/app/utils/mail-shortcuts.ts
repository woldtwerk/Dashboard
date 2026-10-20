import type { MailSummary } from '#layers/mail/shared/types/mail'
import { latestIncomingMail, type OwnMailContext } from '#layers/mail/shared/mail-thread'

/** The view the shortcuts act in: the flat mails list or the grouped conversations */
export type MailShortcutView = 'mails' | 'conversations'

/** The keys Nuxt UI's defineShortcuts listens on, per mail action */
export const MAIL_SHORTCUT_KEYS = {
  delete: ['#', 'delete', 'backspace'],
  reply: ['r'],
  replyAll: ['a'],
  forward: ['f']
} as const

/** One of the actions MAIL_SHORTCUT_KEYS names */
export type MailShortcutAction = keyof typeof MAIL_SHORTCUT_KEYS

/** The open conversation as the page knows it, without its individual mails */
export interface MailOpenConversation {
  key: string
  count: number
  latest: MailSummary
}

/** What the shortcuts see of the page; only the URL and the loaded lists feed it */
export interface MailShortcutState {
  view: MailShortcutView
  /** How many rows the list's own selection holds */
  selectionCount: number
  selectedMail: MailSummary | null
  openConversation: MailOpenConversation | null
  composerOpen: boolean
  /** The open conversation's mails, oldest first, when the panel has loaded them */
  conversationMails?: MailSummary[]
  /** The account's own address and sent folders, to tell its own mail apart */
  own?: OwnMailContext
}

/** What a shortcut acts on; a conversation only once it holds a single mail */
export type MailShortcutTarget = { kind: 'batch' }
  | { kind: 'mail', mail: MailSummary }
  | { kind: 'conversation', key: string, mail: MailSummary }
  | null

/**
 * What # / Delete removes: the list's selection when it has one, then the open
 * mail, then the only mail of an open conversation. A conversation with several
 * mails has no single mail to delete and stays out, as it does in its menu.
 */
export function mailShortcutTarget(state: MailShortcutState): MailShortcutTarget {
  if (state.composerOpen) {
    return null
  }

  if (state.selectionCount > 0) {
    return { kind: 'batch' }
  }

  if (state.view === 'mails') {
    return state.selectedMail ? { kind: 'mail', mail: state.selectedMail } : null
  }

  const conversation = state.openConversation
  if (!conversation || conversation.count !== 1) {
    return null
  }

  return { kind: 'conversation', key: conversation.key, mail: conversation.latest }
}

/**
 * The mail r / a / f answer: the open mail in the mails list, the open
 * conversation's newest mail not sent by the account in the conversations view.
 * Without the conversation's mails, its newest one stands in.
 */
export function mailReplyTarget(state: MailShortcutState): MailSummary | null {
  if (state.composerOpen) {
    return null
  }

  if (state.view === 'mails') {
    return state.selectedMail
  }

  const conversation = state.openConversation
  if (!conversation) {
    return null
  }

  return latestIncomingMail(state.conversationMails ?? [], state.own) ?? conversation.latest
}
