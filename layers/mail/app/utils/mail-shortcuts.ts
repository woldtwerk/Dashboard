import type { MailSummary } from '#layers/mail/shared/types/mail'
import { latestIncomingMail, type OwnMailContext } from '#layers/mail/shared/mail-thread'

/** The view the shortcuts act in: the flat mails list or the grouped conversations */
export type MailShortcutView = 'mails' | 'conversations'

/** The keys Nuxt UI's defineShortcuts listens on, per mail action */
export const MAIL_SHORTCUT_KEYS = {
  delete: ['#', 'delete', 'backspace'],
  reply: ['r'],
  replyAll: ['a'],
  forward: ['f'],
  done: ['e'],
  preview: ['v'],
  saveAttachment: ['shift_s'],
  previewPrevious: ['arrowleft'],
  previewNext: ['arrowright'],
  download: ['shift_d'],
  closePreview: ['escape']
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
  /** The attachment preview is open; no list or single-key action may fire */
  previewOpen?: boolean
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
  if (state.composerOpen || state.previewOpen) {
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

/** What e toggles done on; a conversation keeps every mail, unlike delete */
export type MailDoneTarget = { kind: 'batch' } | { kind: 'mails', mails: MailSummary[] } | null

/**
 * What e toggles done on: the list's selection, the open mail, or every mail of
 * the open conversation — a thread has no single mail to leave out, unlike
 * delete.
 */
export function mailDoneTarget(state: MailShortcutState): MailDoneTarget {
  if (state.composerOpen || state.previewOpen) {
    return null
  }

  if (state.selectionCount > 0) {
    return { kind: 'batch' }
  }

  if (state.view === 'mails') {
    return state.selectedMail ? { kind: 'mails', mails: [state.selectedMail] } : null
  }

  const conversation = state.openConversation
  if (!conversation) {
    return null
  }

  // A thread is only done as a whole; while its mails are still loading, acting
  // on the newest alone would leave the rest behind
  if (conversation.count > 1 && !state.conversationMails?.length) {
    return null
  }

  return {
    kind: 'mails',
    mails: state.conversationMails?.length ? state.conversationMails : [conversation.latest]
  }
}

/**
 * The mail r / a / f answer: the open mail in the mails list, the open
 * conversation's newest mail not sent by the account in the conversations view.
 * Without the conversation's mails, its newest one stands in.
 */
export function mailReplyTarget(state: MailShortcutState): MailSummary | null {
  if (state.composerOpen || state.previewOpen) {
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

/**
 * The mail `v` previews and `shift_s` saves: the open mail in the mails list,
 * or the newest mail of the open conversation that the index says carries an
 * attachment. The composer and an already open preview take the keys away.
 */
export function mailAttachmentTarget(state: MailShortcutState): MailSummary | null {
  if (state.composerOpen || state.previewOpen) {
    return null
  }

  if (state.view === 'mails') {
    return state.selectedMail
  }

  const mails = state.conversationMails?.length
    ? state.conversationMails
    : (state.openConversation ? [state.openConversation.latest] : [])

  return [...mails].reverse().find(mail => mail.hasAttachment) ?? null
}
