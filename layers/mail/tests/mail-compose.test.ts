import { describe, expect, it } from 'vitest'
import type { MailMessage } from '../shared/types/mail'
import {
  buildReply,
  OUTGOING_MESSAGE_ID_LIMIT,
  OUTGOING_RECIPIENT_LIMIT,
  OUTGOING_REFERENCES_LIMIT,
  OUTGOING_SUBJECT_LIMIT,
  OUTGOING_TEXT_LIMIT,
  validateOutgoing,
  type OutgoingMail
} from '../shared/mail-compose'

function message(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    uid: 1,
    mailbox: 'INBOX',
    subject: 'Hello',
    from: [{ name: 'Alice', address: 'alice@example.com' }],
    to: [{ name: 'Me', address: 'me@example.com' }],
    cc: [],
    date: '2026-10-05T10:00:00.000Z',
    unread: false,
    flagged: false,
    messageId: '<root@example.com>',
    text: 'Line one\nLine two',
    ...overrides
  }
}

function mail(overrides: Partial<OutgoingMail> = {}): OutgoingMail {
  return {
    to: [{ address: 'alice@example.com' }],
    cc: [],
    bcc: [],
    subject: 'Hello',
    text: 'Body',
    ...overrides
  }
}

describe('buildReply', () => {
  it('addresses the sender, prefixes the subject and threads the reply', () => {
    const reply = buildReply(message(), ['me@example.com'], 'reply')

    expect(reply.to).toEqual([{ name: 'Alice', address: 'alice@example.com' }])
    expect(reply.cc).toEqual([])
    expect(reply.bcc).toEqual([])
    expect(reply.subject).toBe('Re: Hello')
    expect(reply.inReplyTo).toBe('<root@example.com>')
    expect(reply.references).toEqual(['<root@example.com>'])
  })

  it('prefers the Reply-To header over the sender', () => {
    const original = message({ replyTo: [{ name: 'Support', address: 'support@example.com' }] })

    expect(buildReply(original, [], 'reply').to).toEqual([{ name: 'Support', address: 'support@example.com' }])
  })

  it('quotes the original behind an attribution line', () => {
    const reply = buildReply(message(), [], 'reply')

    expect(reply.text).toContain('On Mon, 05 Oct 2026 10:00:00 GMT, Alice <alice@example.com> wrote:')
    expect(reply.text).toContain('> Line one\n> Line two')
    expect(reply.text.startsWith('\n\n')).toBe(true)
  })

  it('adds the original recipients for reply-all, minus own addresses, deduplicated', () => {
    const original = message({
      to: [{ name: 'Me', address: 'me@example.com' }, { address: 'bob@example.com' }],
      cc: [{ address: 'carol@example.com' }, { name: 'Alice', address: 'alice@example.com' }]
    })

    // Own address is matched case-insensitively; Alice appears once despite From + Cc
    const replyAll = buildReply(original, ['ME@example.com'], 'replyAll')

    expect(replyAll.to).toEqual([
      { name: 'Alice', address: 'alice@example.com' },
      { address: 'bob@example.com' },
      { address: 'carol@example.com' }
    ])
  })

  it('drops every own address from a reply-all, including aliases', () => {
    const original = message({
      from: [{ address: 'alias@example.com' }],
      to: [{ address: 'me@example.com' }],
      cc: []
    })

    expect(buildReply(original, ['me@example.com', 'alias@example.com'], 'replyAll').to).toEqual([])
  })

  it('starts a forward with no recipients and an unquoted header block', () => {
    const forward = buildReply(message(), ['me@example.com'], 'forward')

    expect(forward.to).toEqual([])
    expect(forward.cc).toEqual([])
    expect(forward.bcc).toEqual([])
    expect(forward.subject).toBe('Fwd: Hello')
    expect(forward.inReplyTo).toBeUndefined()
    expect(forward.references).toBeUndefined()
    expect(forward.text).toContain('---------- Forwarded message ----------')
    expect(forward.text).toContain('From: Alice <alice@example.com>')
    expect(forward.text).toContain('Date: Mon, 05 Oct 2026 10:00:00 GMT')
    expect(forward.text).toContain('Subject: Hello')
    expect(forward.text).toContain('To: Me <me@example.com>')
    expect(forward.text).toContain('Line one\nLine two')
    expect(forward.text).not.toContain('> Line one')
  })

  it('does not double a reply or forward prefix that is already there', () => {
    expect(buildReply(message({ subject: 'Re: Hello' }), [], 'reply').subject).toBe('Re: Hello')
    expect(buildReply(message({ subject: 'Re[2]: Hello' }), [], 'reply').subject).toBe('Re[2]: Hello')
    expect(buildReply(message({ subject: 'Fwd: Hello' }), [], 'forward').subject).toBe('Fwd: Hello')
    expect(buildReply(message({ subject: 'AW: Hello' }), [], 'reply').subject).toBe('AW: Hello')
  })

  it('still prefixes a list tag, which is not a reply marker', () => {
    expect(buildReply(message({ subject: '[Security-news] Hello' }), [], 'reply').subject).toBe('Re: [Security-news] Hello')
  })

  it('replaces a line break in the subject with a space', () => {
    expect(buildReply(message({ subject: 'Hello\r\nBcc: evil@example.com' }), [], 'reply').subject)
      .toBe('Re: Hello Bcc: evil@example.com')
  })

  it('chains references and deduplicates the original Message-ID', () => {
    const original = message({
      references: ['<a@example.com>', '<b@example.com>'],
      messageId: '<c@example.com>'
    })
    expect(buildReply(original, [], 'reply').references).toEqual(['<a@example.com>', '<b@example.com>', '<c@example.com>'])

    const repeated = message({
      references: ['<a@example.com>', '<C@example.com>'],
      messageId: '<c@example.com>'
    })
    expect(buildReply(repeated, [], 'reply').references).toEqual(['<a@example.com>', '<C@example.com>'])
  })
})

describe('validateOutgoing', () => {
  it('accepts a well-formed mail', () => {
    expect(validateOutgoing(mail())).toEqual({ valid: true })
  })

  it('requires at least one recipient', () => {
    const result = validateOutgoing(mail({ to: [] }))
    expect(result.valid).toBe(false)
    expect(result).toMatchObject({ error: 'At least one recipient is required' })
  })

  it('counts To, Cc and Bcc against the limit', () => {
    const recipients = (count: number) => Array.from({ length: count }, (_, index) => ({ address: `user${index}@example.com` }))
    expect(validateOutgoing(mail({ to: recipients(OUTGOING_RECIPIENT_LIMIT) })).valid).toBe(true)

    const tooMany = validateOutgoing(mail({
      to: recipients(50),
      cc: recipients(50),
      bcc: recipients(1)
    }))
    expect(tooMany.valid).toBe(false)
  })

  it('rejects a malformed recipient address', () => {
    expect(validateOutgoing(mail({ to: [{ address: 'not-an-address' }] })).valid).toBe(false)
    expect(validateOutgoing(mail({ bcc: [{ name: 'Nobody' }] })).valid).toBe(false)
  })

  it('caps the subject at 998 characters', () => {
    expect(validateOutgoing(mail({ subject: 'x'.repeat(OUTGOING_SUBJECT_LIMIT) })).valid).toBe(true)
    expect(validateOutgoing(mail({ subject: 'x'.repeat(OUTGOING_SUBJECT_LIMIT + 1) })).valid).toBe(false)
  })

  it('caps the body at 1 MiB', () => {
    expect(validateOutgoing(mail({ text: 'x'.repeat(OUTGOING_TEXT_LIMIT) })).valid).toBe(true)
    expect(validateOutgoing(mail({ text: 'x'.repeat(OUTGOING_TEXT_LIMIT + 1) })).valid).toBe(false)
  })

  it('rejects a subject with a line break', () => {
    expect(validateOutgoing(mail({ subject: 'Hi\r\nBcc: evil@example.com' })).valid).toBe(false)
    expect(validateOutgoing(mail({ subject: 'Hi\nBcc: evil@example.com' })).valid).toBe(false)
  })

  it('accepts only whitespace-free Message-IDs of bounded length', () => {
    expect(validateOutgoing(mail({ inReplyTo: '<ok@example.com>' })).valid).toBe(true)
    expect(validateOutgoing(mail({ inReplyTo: 'ok@example.com' })).valid).toBe(true)
    expect(validateOutgoing(mail({ inReplyTo: '<a b@example.com>' })).valid).toBe(false)
    expect(validateOutgoing(mail({ inReplyTo: 'a@example.com\r\nX: injected' })).valid).toBe(false)
    expect(validateOutgoing(mail({ inReplyTo: 'x'.repeat(OUTGOING_MESSAGE_ID_LIMIT + 1) })).valid).toBe(false)
    expect(validateOutgoing(mail({ references: ['<a@example.com>', 'bad id'] })).valid).toBe(false)
  })

  it('caps the reference chain at 100 Message-IDs', () => {
    const references = (count: number) => Array.from({ length: count }, (_, index) => `<r${index}@example.com>`)
    expect(validateOutgoing(mail({ references: references(OUTGOING_REFERENCES_LIMIT) })).valid).toBe(true)
    expect(validateOutgoing(mail({ references: references(OUTGOING_REFERENCES_LIMIT + 1) })).valid).toBe(false)
  })
})
