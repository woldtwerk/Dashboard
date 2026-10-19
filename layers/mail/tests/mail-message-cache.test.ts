import { describe, expect, it } from 'vitest'
import type { MailMessage } from '../shared/types/mail'
import { mailMessageCacheKey, rememberMailMessage, type MailMessageRequests } from '../app/utils/mail-message-cache'

function request(uid: number): Promise<MailMessage> {
  return Promise.resolve({ uid } as MailMessage)
}

function keys(cache: MailMessageRequests): string[] {
  return [...cache.keys()]
}

describe('mailMessageCacheKey', () => {
  it('keeps uids of the same mailbox and of equal uids in other folders apart', () => {
    expect(mailMessageCacheKey('svc', 'INBOX', 7)).toBe('svc:INBOX:7')
    expect(mailMessageCacheKey('svc', 'INBOX', 7)).not.toBe(mailMessageCacheKey('svc', 'Sent', 7))
    expect(mailMessageCacheKey('a', 'INBOX', 7)).not.toBe(mailMessageCacheKey('b', 'INBOX', 7))
  })
})

describe('rememberMailMessage', () => {
  it('returns the request it stored', () => {
    const cache: MailMessageRequests = new Map()
    const pending = request(1)

    expect(rememberMailMessage(cache, 'a', pending)).toBe(pending)
    expect(cache.get('a')).toBe(pending)
  })

  it('drops the oldest entry beyond the limit', () => {
    const cache: MailMessageRequests = new Map()

    rememberMailMessage(cache, 'a', request(1), 2)
    rememberMailMessage(cache, 'b', request(2), 2)
    rememberMailMessage(cache, 'c', request(3), 2)

    expect(keys(cache)).toEqual(['b', 'c'])
  })

  it('moves a re-remembered key to the newest end', () => {
    const cache: MailMessageRequests = new Map()

    rememberMailMessage(cache, 'a', request(1), 2)
    rememberMailMessage(cache, 'b', request(2), 2)
    rememberMailMessage(cache, 'a', request(3), 2)
    rememberMailMessage(cache, 'c', request(4), 2)

    expect(keys(cache)).toEqual(['a', 'c'])
  })

  it('keeps everything under the limit', () => {
    const cache: MailMessageRequests = new Map()

    rememberMailMessage(cache, 'a', request(1), 3)
    rememberMailMessage(cache, 'b', request(2), 3)

    expect(keys(cache)).toEqual(['a', 'b'])
  })
})
