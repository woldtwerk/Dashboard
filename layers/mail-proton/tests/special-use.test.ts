import { describe, expect, it } from 'vitest'
import { isProtonLabel, protonSpecialUse } from '../server/proton/special-use'

describe('protonSpecialUse', () => {
  it('keeps the special use the server reports', () => {
    expect(protonSpecialUse('INBOX', '\\Inbox')).toBe('\\Inbox')
    expect(protonSpecialUse('Sent', '\\Sent')).toBe('\\Sent')
  })

  it('derives the flag of the virtual folders Bridge reports without one', () => {
    expect(protonSpecialUse('All Mail')).toBe('\\All')
    expect(protonSpecialUse('Starred')).toBe('\\Flagged')
  })

  it('leaves real folders and labels without a special use', () => {
    expect(protonSpecialUse('Folders/Work')).toBeUndefined()
    expect(protonSpecialUse('Labels/Receipts')).toBeUndefined()
  })
})

describe('isProtonLabel', () => {
  it('marks paths under Labels/ and nothing else', () => {
    expect(isProtonLabel('Labels/Receipts')).toBe(true)
    expect(isProtonLabel('Labels/Receipts/Nested')).toBe(true)
    expect(isProtonLabel('Folders/Work')).toBe(false)
    expect(isProtonLabel('INBOX')).toBe(false)
    expect(isProtonLabel('Labels')).toBe(false)
  })
})
