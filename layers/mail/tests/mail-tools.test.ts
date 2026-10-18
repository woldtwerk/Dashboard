import { describe, expect, it } from 'vitest'
import { MAIL_TOOL_TEXT_LIMIT, mailReadInput, mailSearchInput, toMailToolSearch } from '../server/tools'

describe('toMailToolSearch', () => {
  it('maps the tool input onto the domain search', () => {
    const input = mailSearchInput.parse({
      text: ' invoice ',
      from: 'stripe',
      unread: true,
      flagged: true,
      hasAttachment: true,
      since: '2026-10-01',
      before: '2026-11-01'
    })

    expect(toMailToolSearch(input)).toEqual({
      text: 'invoice',
      from: 'stripe',
      unread: true,
      flagged: true,
      hasAttachment: true,
      since: '2026-10-01',
      before: '2026-11-01'
    })
  })

  it('drops empty criteria and defaults the scope to the current folder', () => {
    const parsed = mailSearchInput.parse({})

    expect(toMailToolSearch(parsed)).toEqual({ text: undefined, from: undefined, unread: undefined, flagged: undefined, hasAttachment: undefined, since: undefined, before: undefined })
    expect(parsed.mailbox).toBe('INBOX')
    expect(parsed.scope).toBe('folder')
  })

  it('caps the limit at 25 and mail_read text at 20 000 characters', () => {
    expect(mailSearchInput.safeParse({ limit: 26 }).success).toBe(false)
    expect(mailReadInput.safeParse({ service: 's', mailbox: 'INBOX', uid: 1 }).success).toBe(true)
    expect(MAIL_TOOL_TEXT_LIMIT).toBe(20_000)
  })
})
