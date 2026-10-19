import { describe, expect, it } from 'vitest'
import { invalidMailAddresses, parseMailAddresses, toOutgoingMail } from '../app/utils/mail-compose'

describe('mail compose addresses', () => {
  it('parses a bare address and a named one', () => {
    expect(parseMailAddresses(['alice@example.com', 'Bob <bob@example.com>'])).toEqual([
      { name: undefined, address: 'alice@example.com' },
      { name: 'Bob', address: 'bob@example.com' }
    ])
  })

  it('flags the tags that are not addresses', () => {
    expect(invalidMailAddresses(['alice@example.com', 'nope', 'Bob <bob@example.com>'])).toEqual(['nope'])
  })

  it('builds an outgoing mail from the draft', () => {
    expect(toOutgoingMail({ from: 'me@example.com', to: ['alice@example.com'], cc: [], bcc: [], subject: '  Hi  ', text: 'Body' })).toEqual({
      from: 'me@example.com',
      to: [{ name: undefined, address: 'alice@example.com' }],
      cc: [],
      bcc: [],
      subject: 'Hi',
      text: 'Body'
    })
  })

  it('keeps the draft\'s From address', () => {
    const sent = toOutgoingMail({ from: 'alias@example.com', to: ['alice@example.com'], cc: [], bcc: [], subject: 'Hi', text: 'Body' })

    expect(sent.from).toBe('alias@example.com')
  })

  it('drops an empty From', () => {
    expect(toOutgoingMail({ from: '', to: ['alice@example.com'], cc: [], bcc: [], subject: 'Hi', text: 'Body' }).from).toBeUndefined()
  })
})
