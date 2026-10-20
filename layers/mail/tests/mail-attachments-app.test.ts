import { describe, expect, it } from 'vitest'
import { mailAttachmentPreviewFromQuery, mailAttachmentPreviewToQuery } from '../app/utils/mail-attachments'

describe('attachment preview query', () => {
  it('round-trips the part and the mail it belongs to', () => {
    const preview = { part: '2.1', uid: 7, mailbox: 'Folders/Work' }
    expect(mailAttachmentPreviewFromQuery(mailAttachmentPreviewToQuery(preview))).toEqual(preview)
    expect(mailAttachmentPreviewToQuery(null)).toEqual({ att: undefined, attuid: undefined, attbox: undefined })
  })

  it('falls back to the open mail when the URL has only the part', () => {
    expect(mailAttachmentPreviewFromQuery({ att: '2' }, { uid: 7, mailbox: 'INBOX' }))
      .toEqual({ part: '2', uid: 7, mailbox: 'INBOX' })
  })

  it('has no preview without a part or a mail to attach it to', () => {
    expect(mailAttachmentPreviewFromQuery({}, { uid: 7, mailbox: 'INBOX' })).toBeNull()
    expect(mailAttachmentPreviewFromQuery({ att: '2' })).toBeNull()
    expect(mailAttachmentPreviewFromQuery({ att: '2', attuid: '0', attbox: 'INBOX' })).toBeNull()
  })
})
