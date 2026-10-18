import { describe, expect, it } from 'vitest'
import { MAIL_TOOL_TEXT_LIMIT, mailDeleteInput, mailReadInput, mailSearchInput, mailSendInput, toMailToolSearch } from '../server/tools'

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

  it('defaults the delete tool to a recoverable delete', () => {
    const input = mailDeleteInput.parse({ service: 's', mailbox: 'INBOX', uid: 1 })

    expect(input.permanent).toBe(false)
    expect(mailDeleteInput.parse({ service: 's', mailbox: 'INBOX', uid: 1, permanent: true }).permanent).toBe(true)
  })
})

describe('mailSendInput', () => {
  const base = { service: 's', to: [{ address: 'alice@example.com' }], subject: 'Hi', text: 'Body' }

  it('accepts a well-formed mail and a well-formed reply id', () => {
    expect(mailSendInput.safeParse(base).success).toBe(true)
    expect(mailSendInput.safeParse({ ...base, inReplyTo: '<root@example.com>', references: ['<root@example.com>'] }).success).toBe(true)
  })

  it('rejects a subject or Message-ID carrying a line break', () => {
    expect(mailSendInput.safeParse({ ...base, subject: 'Hi\r\nBcc: evil@example.com' }).success).toBe(false)
    expect(mailSendInput.safeParse({ ...base, inReplyTo: 'a@example.com\r\nX: injected' }).success).toBe(false)
    expect(mailSendInput.safeParse({ ...base, references: ['<ok@example.com>', 'bad id'] }).success).toBe(false)
  })
})
