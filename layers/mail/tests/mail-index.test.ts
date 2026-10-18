import { describe, expect, it } from 'vitest'
import type { MailMessage } from '../shared/types/mail'
import { diffMailboxState } from '../server/mail-index/diff'
import { hasSearchCriteria, mailDocumentId, MAX_TEXT_LENGTH, normalizeSenderTerm, senderTerms, toMailDocument } from '../server/mail-index/document'
import { mailIndexStateIsCurrent, MAIL_INDEX_SCHEMA_VERSION } from '../server/mail-index/version'

const message: MailMessage = {
  uid: 42,
  mailbox: 'INBOX',
  subject: 'Your receipt',
  from: [{ name: 'Stripe, Inc.', address: 'Receipts@Mail.Stripe.com' }],
  to: [{ name: 'Me', address: 'me@proton.me' }],
  cc: [{ address: 'team@example.com' }],
  date: '2026-10-16T10:00:00.000Z',
  unread: true,
  flagged: false,
  messageId: '<abc@stripe.com>',
  hasAttachment: true,
  text: 'Amount\n\n  paid:   12 €'
}

describe('mailDocumentId', () => {
  it('is stable and only uses engine-safe characters', () => {
    const id = mailDocumentId('5f0c-uuid', 'Folders/Work & Ärger', 7)

    expect(id).toBe(mailDocumentId('5f0c-uuid', 'Folders/Work & Ärger', 7))
    expect(id).toMatch(/^[\w-]+$/)
    expect(id).not.toBe(mailDocumentId('5f0c-uuid', 'INBOX', 7))
  })
})

describe('senderTerms', () => {
  it('collects name words, address, domain and brand', () => {
    expect(senderTerms(message.from)).toEqual(['stripe', 'inc', 'receipts@mail.stripe.com', 'mail.stripe.com'])
  })

  it('normalizes filters the same way', () => {
    expect(normalizeSenderTerm(' @Stripe.com ')).toBe('stripe.com')
  })
})

describe('toMailDocument', () => {
  it('flattens a message for the index', () => {
    expect(toMailDocument('svc', 'INBOX', message)).toMatchObject({
      id: mailDocumentId('svc', 'INBOX', 42),
      service: 'svc',
      messageId: '<abc@stripe.com>',
      conversationKeys: ['subj:receipts@mail.stripe.com:your receipt', 'id:abc@stripe.com'],
      fromText: 'Stripe, Inc. <Receipts@Mail.Stripe.com>',
      toText: 'Me <me@proton.me>, team@example.com',
      toList: message.to,
      ccList: message.cc,
      participantTerms: ['receipts@mail.stripe.com', 'me@proton.me', 'team@example.com'],
      date: 1_792_144_800,
      unread: true,
      hasAttachment: true,
      text: 'Amount paid: 12 €'
    })
  })

  it('indexes the stream key and List-Id of a mailing list mail', () => {
    const document = toMailDocument('svc', 'INBOX', {
      ...message,
      listId: 'security-news.drupal.org',
      listName: 'Drupal Security News',
      bulk: true
    })

    expect(document.conversationKeys).toContain('list:security-news.drupal.org')
    expect(document).toMatchObject({ listId: 'security-news.drupal.org', listName: 'Drupal Security News' })
  })

  it('deduplicates participant addresses across from, to and cc', () => {
    const document = toMailDocument('svc', 'INBOX', {
      ...message,
      to: [{ address: 'me@proton.me' }, { address: 'Receipts@mail.stripe.com' }]
    })

    expect(document.participantTerms).toEqual(['receipts@mail.stripe.com', 'me@proton.me', 'team@example.com'])
  })

  it('defaults hasAttachment to false without a parsed body', () => {
    expect(toMailDocument('svc', 'INBOX', { ...message, hasAttachment: undefined }).hasAttachment).toBe(false)
  })

  it('falls back to its own id without Message-ID and caps the text', () => {
    const document = toMailDocument('svc', 'INBOX', { ...message, messageId: undefined, text: 'x'.repeat(MAX_TEXT_LENGTH + 10) })

    expect(document.messageId).toBe(document.id)
    expect(document.text).toHaveLength(MAX_TEXT_LENGTH)
  })
})

describe('hasSearchCriteria', () => {
  it('ignores empty criteria', () => {
    expect(hasSearchCriteria({})).toBe(false)
    expect(hasSearchCriteria({ text: '', unread: false })).toBe(false)
    expect(hasSearchCriteria({ from: 'stripe' })).toBe(true)
    expect(hasSearchCriteria({ hasAttachment: true })).toBe(true)
  })
})

describe('mailIndexStateIsCurrent', () => {
  it('is current only for the same UIDVALIDITY and document schema version', () => {
    expect(mailIndexStateIsCurrent({ uidValidity: 'v1', schemaVersion: MAIL_INDEX_SCHEMA_VERSION }, 'v1')).toBe(true)
    expect(mailIndexStateIsCurrent({ uidValidity: 'v1', schemaVersion: MAIL_INDEX_SCHEMA_VERSION }, 'v2')).toBe(false)
    expect(mailIndexStateIsCurrent({ uidValidity: 'v1', schemaVersion: MAIL_INDEX_SCHEMA_VERSION - 1 }, 'v1')).toBe(false)
    expect(mailIndexStateIsCurrent(undefined, 'v1')).toBe(false)
  })
})

describe('diffMailboxState', () => {
  const indexed = new Map([
    [1, { unread: false, flagged: false }],
    [2, { unread: true, flagged: false }],
    [3, { unread: false, flagged: false }]
  ])

  it('finds added, changed and removed messages', () => {
    const diff = diffMailboxState(indexed, [
      { uid: 1, unread: false, flagged: false },
      { uid: 2, unread: false, flagged: true },
      { uid: 4, unread: true, flagged: false },
      { uid: 9, unread: true, flagged: false }
    ])

    expect(diff).toEqual({
      added: [9, 4],
      changed: [{ uid: 2, unread: false, flagged: true }],
      removed: [3]
    })
  })
})
