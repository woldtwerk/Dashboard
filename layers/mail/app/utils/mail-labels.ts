import type { MailConversation, MailSummary } from '#layers/mail/shared/types/mail'
import { labelFromMailbox } from '#layers/mail/shared/mail-labels'
import { mailKey } from './mail'

/** A mail with the label added or removed; the same object when nothing changes */
export function applyLabelToMail(mail: MailSummary, label: string, on: boolean): MailSummary {
  const labels = new Set(mail.labels ?? [])
  const had = labels.has(label)

  if (on === had) {
    return mail
  }

  if (on) {
    labels.add(label)
  } else {
    labels.delete(label)
  }

  return { ...mail, labels: [...labels] }
}

/** Applies a label to the mails whose key is in `keys`, keeping the list order */
export function applyLabel(list: MailSummary[], keys: Iterable<string>, label: string, on: boolean): MailSummary[] {
  const affected = new Set(keys)
  return list.map(mail => affected.has(mailKey(mail)) ? applyLabelToMail(mail, label, on) : mail)
}

/**
 * Puts the labels back a failed request could not apply. `previous` holds the
 * labels each mail had before the optimistic change.
 */
export function restoreLabels(list: MailSummary[], previous: Map<string, string[] | undefined>): MailSummary[] {
  return list.map((mail) => {
    const key = mailKey(mail)
    return previous.has(key) ? { ...mail, labels: previous.get(key) } : mail
  })
}

/** Mirrors a label change onto the conversation rows, which render their latest mail */
export function applyLabelToConversations(
  conversations: MailConversation[],
  mailKeys: Iterable<string>,
  label: string,
  on: boolean
): MailConversation[] {
  const affected = new Set(mailKeys)
  return conversations.map(conversation =>
    affected.has(mailKey(conversation.latest))
      ? { ...conversation, latest: applyLabelToMail(conversation.latest, label, on) }
      : conversation
  )
}

/**
 * Whether a mail carries the label. A provider summary has no `labels`, but a
 * mail browsed inside the label's own folder is filed under it too.
 */
function hasLabel(mail: Pick<MailSummary, 'labels' | 'mailbox'>, label: string): boolean {
  return labelFromMailbox(mail.mailbox) === label || (mail.labels ?? []).includes(label)
}

/** Whether every mail carries the label; a toggle removes it only when they all do */
export function labelToggleState(targets: Pick<MailSummary, 'labels' | 'mailbox'>[], label: string): boolean {
  return targets.length > 0 && targets.every(mail => hasLabel(mail, label))
}

/** The `e` action: add the done label unless every target already has it */
export function doneToggleState(targets: Pick<MailSummary, 'labels' | 'mailbox'>[], doneLabel: string): { on: boolean } {
  return { on: !labelToggleState(targets, doneLabel) }
}

/** One entry of a label submenu */
export interface MailLabelChoice {
  label: string
  /** Every target already carries it, so selecting it removes the label */
  active: boolean
}

/** The account's labels with their state for the current targets; drives both menus */
export function mailLabelChoices(labels: string[], targets: Pick<MailSummary, 'labels' | 'mailbox'>[]): MailLabelChoice[] {
  return labels.map(label => ({ label, active: labelToggleState(targets, label) }))
}
