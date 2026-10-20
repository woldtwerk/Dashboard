import { describe, expect, it } from 'vitest'
import type { MailSummary } from '../shared/types/mail'
import { nextSelection, nextSelectionAfter, removeFromList } from '../app/utils/mail-delete'
import { mailKey } from '../app/utils/mail'

const mail = (uid: number, mailbox = 'INBOX'): MailSummary => ({
  uid,
  mailbox,
  subject: `Mail ${uid}`,
  from: [],
  date: '2026-10-16T10:00:00Z',
  unread: false,
  flagged: false
})

const keys = (list: MailSummary[]) => list.map(mailKey)

describe('nextSelection', () => {
  const list = [mail(3), mail(2), mail(1)]

  it('opens the mail after the deleted one', () => {
    expect(nextSelection(list, mailKey(mail(2)))).toEqual(mail(1))
  })

  it('falls back to the mail before it when it was the last', () => {
    expect(nextSelection(list, mailKey(mail(1)))).toEqual(mail(2))
  })

  it('returns null when the deleted mail was the only one', () => {
    expect(nextSelection([mail(5)], mailKey(mail(5)))).toBeNull()
  })

  it('returns null when the key is not in the list', () => {
    expect(nextSelection(list, mailKey(mail(9)))).toBeNull()
  })

  it('tells mailboxes apart', () => {
    expect(nextSelection([mail(1, 'Trash')], mailKey(mail(1)))).toBeNull()
  })
})

describe('nextSelectionAfter', () => {
  const list = [mail(5), mail(4), mail(3), mail(2), mail(1)]

  it('opens the first remaining mail after the deleted ones', () => {
    expect(nextSelectionAfter(list, [mailKey(mail(4)), mailKey(mail(3))])).toEqual(mail(2))
  })

  it('falls back to the mail before them when the batch was last', () => {
    expect(nextSelectionAfter(list, [mailKey(mail(2)), mailKey(mail(1))])).toEqual(mail(3))
  })

  it('returns null when every mail went', () => {
    expect(nextSelectionAfter([mail(1)], [mailKey(mail(1))])).toBeNull()
  })

  it('returns null when none of the keys is in the list', () => {
    expect(nextSelectionAfter(list, [mailKey(mail(9))])).toBeNull()
  })
})

describe('removeFromList', () => {
  it('drops the mail with the key and keeps the order', () => {
    expect(keys(removeFromList([mail(3), mail(2), mail(1)], mailKey(mail(2))))).toEqual([mailKey(mail(3)), mailKey(mail(1))])
  })

  it('returns the list unchanged when the key is absent', () => {
    expect(keys(removeFromList([mail(3), mail(2)], mailKey(mail(9))))).toEqual([mailKey(mail(3)), mailKey(mail(2))])
  })
})
