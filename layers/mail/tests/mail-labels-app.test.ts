import { describe, expect, it } from 'vitest'
import type { MailConversation, MailSummary } from '../shared/types/mail'
import { applyLabel, applyLabelToConversations, applyLabelToMail, doneToggleState, labelToggleState, mailLabelChoices, restoreLabels } from '../app/utils/mail-labels'
import { mailKey } from '../app/utils/mail'

const mail = (uid: number, labels?: string[], mailbox = 'INBOX'): MailSummary => ({
  uid,
  mailbox,
  subject: `Mail ${uid}`,
  from: [],
  date: '2026-10-16T10:00:00Z',
  unread: false,
  flagged: false,
  labels
})

const conversation = (key: string, latest: MailSummary): MailConversation => ({
  key,
  subject: latest.subject,
  participants: [],
  count: 1,
  unread: false,
  latest
})

describe('applyLabelToMail', () => {
  it('adds and removes the label without touching the others', () => {
    expect(applyLabelToMail(mail(1, ['Invoices']), 'Done', true).labels).toEqual(['Invoices', 'Done'])
    expect(applyLabelToMail(mail(1, ['Invoices', 'Done']), 'Done', false).labels).toEqual(['Invoices'])
  })

  it('returns the same mail when the label is already in that state', () => {
    const source = mail(1, ['Done'])
    expect(applyLabelToMail(source, 'Done', true)).toBe(source)
    expect(applyLabelToMail(source, 'Other', false)).toBe(source)
  })

  it('adds the first label to a mail without any', () => {
    expect(applyLabelToMail(mail(1), 'Done', true).labels).toEqual(['Done'])
  })
})

describe('applyLabel', () => {
  it('changes only the mails whose key is selected', () => {
    const list = [mail(1), mail(2)]
    const result = applyLabel(list, [mailKey(mail(2))], 'Done', true)

    expect(result[0]!.labels).toBeUndefined()
    expect(result[1]!.labels).toEqual(['Done'])
  })
})

describe('restoreLabels', () => {
  it('puts the previous labels back, including none', () => {
    const first = mail(1, ['Done'])
    const second = mail(2, ['Done'])
    const previous = new Map<string, string[] | undefined>([
      [mailKey(first), ['Invoices']],
      [mailKey(second), undefined]
    ])

    const restored = restoreLabels([first, second], previous)

    expect(restored[0]!.labels).toEqual(['Invoices'])
    expect(restored[1]!.labels).toBeUndefined()
  })
})

describe('applyLabelToConversations', () => {
  it('updates the latest mail of a matching conversation', () => {
    const latest = mail(1)
    const result = applyLabelToConversations([conversation('a', latest)], [mailKey(latest)], 'Done', true)

    expect(result[0]!.latest.labels).toEqual(['Done'])
  })
})

describe('doneToggleState', () => {
  it('adds the label unless every target already has it', () => {
    expect(doneToggleState([mail(1), mail(2, ['Done'])], 'Done')).toEqual({ on: true })
    expect(doneToggleState([mail(1, ['Done']), mail(2, ['Done'])], 'Done')).toEqual({ on: false })
  })

  it('counts a mail browsed in the label folder as labelled without a label list', () => {
    expect(labelToggleState([mail(1, undefined, 'Labels/Done')], 'Done')).toBe(true)
    expect(doneToggleState([mail(1, undefined, 'Labels/Done')], 'Done')).toEqual({ on: false })
  })

  it('has nothing to toggle without targets', () => {
    expect(labelToggleState([], 'Done')).toBe(false)
  })
})

describe('mailLabelChoices', () => {
  it('marks a label active only when every target carries it', () => {
    expect(mailLabelChoices(['Done', 'Invoices'], [mail(1, ['Done']), mail(2, ['Done', 'Invoices'])])).toEqual([
      { label: 'Done', active: true },
      { label: 'Invoices', active: false }
    ])
  })
})
