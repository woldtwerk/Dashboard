import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_POST_TAG, HIGHLIGHT_PRE_TAG } from '../shared/mail-highlight'
import { formatAddresses, mailLink, toMailSource } from '../shared/mail-source'

describe('mail source', () => {
  it('links to the mail page', () => {
    expect(mailLink('svc', 'Folders/Work', 7)).toBe('/mail?service=svc&mailbox=Folders%2FWork&uid=7')
  })

  it('formats senders and falls back for missing subjects', () => {
    expect(formatAddresses([{ name: 'Alice', address: 'a@x.io' }, { address: 'b@x.io' }])).toBe('Alice <a@x.io>, b@x.io')
    expect(toMailSource('svc', { uid: 1, mailbox: 'INBOX', subject: '', from: [], date: '2026-10-16T10:00:00Z', unread: false, flagged: false }).subject).toBe('(no subject)')
  })

  it('strips the search highlight markers the index adds for the UI', () => {
    const mail = { uid: 1, mailbox: 'INBOX', subject: 'x', from: [], date: '2026-10-16T10:00:00Z', unread: false, flagged: false, snippet: `${HIGHLIGHT_PRE_TAG}Rechnung${HIGHLIGHT_POST_TAG} bezahlt` }

    expect(toMailSource('svc', mail).snippet).toBe('Rechnung bezahlt')
  })
})
