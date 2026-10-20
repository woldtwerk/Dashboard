import { describe, expect, it } from 'vitest'
import { isValidLabelName, labelFromMailbox, LABEL_NAME_MAX, labelMailbox } from '../shared/mail-labels'

describe('labelMailbox', () => {
  it('files a label under Labels/', () => {
    expect(labelMailbox('Done')).toBe('Labels/Done')
    expect(labelMailbox('Rechnungen 2026')).toBe('Labels/Rechnungen 2026')
  })
})

describe('labelFromMailbox', () => {
  it('reads the label of a label folder', () => {
    expect(labelFromMailbox('Labels/Done')).toBe('Done')
    expect(labelFromMailbox('Labels/Rechnungen 2026')).toBe('Rechnungen 2026')
  })

  it('is undefined for real and virtual folders', () => {
    expect(labelFromMailbox('INBOX')).toBeUndefined()
    expect(labelFromMailbox('Folders/Work')).toBeUndefined()
    expect(labelFromMailbox('All Mail')).toBeUndefined()
    expect(labelFromMailbox('Labels/')).toBeUndefined()
  })

  it('round-trips through labelMailbox', () => {
    expect(labelFromMailbox(labelMailbox('Done'))).toBe('Done')
  })
})

describe('isValidLabelName', () => {
  it('accepts a plain label name', () => {
    expect(isValidLabelName('Done')).toBe(true)
    expect(isValidLabelName(' Rechnungen 2026 ')).toBe(true)
  })

  it('rejects empty names and names longer than the limit', () => {
    expect(isValidLabelName('')).toBe(false)
    expect(isValidLabelName('   ')).toBe(false)
    expect(isValidLabelName('x'.repeat(LABEL_NAME_MAX))).toBe(true)
    expect(isValidLabelName('x'.repeat(LABEL_NAME_MAX + 1))).toBe(false)
  })

  it('rejects path separators and traversal segments', () => {
    expect(isValidLabelName('Work/Invoices')).toBe(false)
    expect(isValidLabelName('../Done')).toBe(false)
    expect(isValidLabelName('Done..Old')).toBe(false)
  })
})
