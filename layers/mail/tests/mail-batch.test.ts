import { describe, expect, it } from 'vitest'
import type { MailConversation, MailSummary } from '../shared/types/mail'
import { applyMailDelete, mailBatchGroups, MAIL_BATCH_MAX, restoreMailDelete } from '../app/utils/mail-batch'
import type { RetainedMails } from '../app/utils/mail-retention'
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

const conversation = (key: string, latest: MailSummary, count = 1): MailConversation => ({
  key,
  subject: latest.subject,
  participants: [],
  count,
  unread: false,
  latest
})

describe('mailBatchGroups', () => {
  it('groups uids by mailbox in selection order', () => {
    expect(mailBatchGroups([mail(2), mail(5), mail(9, 'Archive'), mail(3)])).toEqual([
      { mailbox: 'INBOX', uids: [2, 5, 3] },
      { mailbox: 'Archive', uids: [9] }
    ])
  })

  it('drops a mail that is in the selection twice', () => {
    expect(mailBatchGroups([mail(2), mail(2)])).toEqual([{ mailbox: 'INBOX', uids: [2] }])
  })

  it('splits a mailbox at the batch cap', () => {
    const uids = Array.from({ length: MAIL_BATCH_MAX + 1 }, (_, index) => index + 1)
    const groups = mailBatchGroups(uids.map(uid => mail(uid)))

    expect(groups).toEqual([
      { mailbox: 'INBOX', uids: uids.slice(0, MAIL_BATCH_MAX) },
      { mailbox: 'INBOX', uids: uids.slice(MAIL_BATCH_MAX) }
    ])
    expect(groups.every(group => group.uids.length <= MAIL_BATCH_MAX)).toBe(true)
  })

  it('has nothing to send for an empty selection', () => {
    expect(mailBatchGroups([])).toEqual([])
  })
})

describe('applyMailDelete', () => {
  it('removes the mails, their retention and the conversations they emptied', () => {
    const list = [mail(3), mail(2), mail(1)]
    const retained: RetainedMails = new Map([[mailKey(mail(2)), { mail: mail(2), until: null }]])
    const conversations = [conversation('one', mail(1)), conversation('many', mail(2), 2)]

    const state = applyMailDelete({ list, retained, conversations }, [mail(2), mail(1)])

    expect(state.list.map(mailKey)).toEqual([mailKey(mail(3))])
    expect(state.retained.has(mailKey(mail(2)))).toBe(false)
    expect(state.conversations.map(item => item.key)).toEqual(['many'])
    expect(state.undo.entries.map(entry => [entry.mail.uid, entry.listIndex])).toEqual([[2, 1], [1, 2]])
  })

  it('leaves the conversation of a multi-mail thread in place', () => {
    const list = [mail(2), mail(1)]
    const conversations = [conversation('many', mail(1), 4)]

    const state = applyMailDelete({ list, retained: new Map(), conversations }, [mail(1)])

    expect(state.conversations).toEqual(conversations)
    expect(state.undo.entries[0]!.conversation).toBeUndefined()
  })

  it('keeps a mail that was not in the loaded list in the undo snapshot', () => {
    const state = applyMailDelete({ list: [mail(1)], retained: new Map(), conversations: [] }, [mail(9)])

    expect(state.list.map(mailKey)).toEqual([mailKey(mail(1))])
    expect(state.undo.entries[0]!.listIndex).toBe(-1)
  })
})

describe('restoreMailDelete', () => {
  it('puts the mails, their retention and a conversation back where they were', () => {
    const list = [mail(3), mail(2), mail(1)]
    const retained: RetainedMails = new Map([[mailKey(mail(2)), { mail: mail(2), until: null }]])
    const conversations = [conversation('one', mail(1))]

    const deleted = applyMailDelete({ list, retained, conversations }, [mail(2), mail(1)])
    const restored = restoreMailDelete(
      { list: deleted.list, retained: deleted.retained, conversations: deleted.conversations },
      deleted.undo
    )

    expect(restored.list.map(mailKey)).toEqual(list.map(mailKey))
    expect(restored.retained.has(mailKey(mail(2)))).toBe(true)
    expect(restored.conversations.map(item => item.key)).toEqual(['one'])
  })

  it('restores a mail under the uid it got when it moved back out of the trash', () => {
    const list = [mail(2), mail(1)]
    const deleted = applyMailDelete({ list, retained: new Map(), conversations: [] }, [mail(1)])
    const restored = restoreMailDelete(
      { list: deleted.list, retained: deleted.retained, conversations: deleted.conversations },
      deleted.undo,
      source => source.uid === 1 ? { ...source, uid: 99 } : source
    )

    expect(restored.list.map(item => item.uid)).toEqual([2, 99])
  })
})
