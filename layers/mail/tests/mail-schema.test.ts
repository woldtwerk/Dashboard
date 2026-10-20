import { describe, expect, it } from 'vitest'
import { messagesQuerySchema } from '../server/utils/mail-schema'

const query = (values: Record<string, unknown>) => messagesQuerySchema.safeParse({ service: 'mail-1', ...values })

describe('messagesQuerySchema', () => {
  it('accepts plain label names', () => {
    expect(query({ label: 'Invoices', notLabel: 'Done' }).success).toBe(true)
  })

  it('rejects a label with a path separator', () => {
    expect(query({ label: 'Work/Invoices' }).success).toBe(false)
    expect(query({ notLabel: '../Done' }).success).toBe(false)
  })

  it('rejects an empty label', () => {
    expect(query({ label: '  ' }).success).toBe(false)
  })
})
