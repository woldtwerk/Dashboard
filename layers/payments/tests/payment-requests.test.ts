import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, openSqlite } from '#layers/core/server/db/client'
import { loadMigrations, runMigrations } from '#layers/core/server/db/migrate'
import { services } from '#layers/core/server/db/schema'
import { paymentReceipts, paymentRequests } from '../server/db/schema'
import {
  cancelPaymentRequest,
  createPaymentRequests,
  getPaymentRequest,
  markPaid,
  markSent,
  markUnpaid,
  openRequestsForMatching
} from '../server/utils/payment-requests'
import type { PaymentRequestInput } from '../server/utils/payment-requests'

const migrationsDir = fileURLToPath(new URL('../../core/server/db/migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

const SERVICE = 'payee-1'
let sqlite: ReturnType<typeof openSqlite>

function input(overrides: Partial<PaymentRequestInput> = {}): PaymentRequestInput {
  return {
    title: 'Dinner',
    amountCents: 1000,
    payerName: 'Anna Müller',
    payerEmail: 'anna@example.com',
    ...overrides
  }
}

beforeEach(async () => {
  sqlite = openSqlite(':memory:')
  runMigrations(sqlite, await loadMigrations(readMigration))

  const db = createDatabase(sqlite, { services, paymentRequests, paymentReceipts })
  await db.insert(services).values({
    id: SERVICE,
    connector: 'payee',
    domain: 'payments',
    name: 'Payee',
    settings: '{}',
    createdAt: new Date(),
    updatedAt: new Date()
  })

  vi.stubGlobal('useDb', () => db)
  vi.stubGlobal('publishDomainEvent', vi.fn(async () => {}))
})

afterEach(() => {
  vi.unstubAllGlobals()
  sqlite.close()
})

describe('creating payment requests', () => {
  it('stores an open request with a reference and a batch id', async () => {
    const [request] = await createPaymentRequests(SERVICE, [input()], { batchId: 'batch-1' })

    expect(request!.reference).toMatch(/^AM-[0-9A-HJKMNP-TV-Z]{6}$/)
    expect(request!.status).toBe('open')
    expect(request!.paidCents).toBe(0)
    expect(request!.batchId).toBe('batch-1')
  })

  it('retries a colliding reference with a fresh one', async () => {
    const [first] = await createPaymentRequests(SERVICE, [input()])
    let calls = 0
    const generateReference = () => {
      calls++
      return calls === 1 ? first!.reference : 'AM-ZZZZZZ'
    }

    const [second] = await createPaymentRequests(SERVICE, [input({ title: 'Other' })], { generateReference })

    expect(calls).toBe(2)
    expect(second!.reference).toBe('AM-ZZZZZZ')
  })

  it('lists only open requests for matching, optionally of one payee', async () => {
    const [open] = await createPaymentRequests(SERVICE, [input()])
    const [paid] = await createPaymentRequests(SERVICE, [input({ title: 'Paid' })])
    await markPaid(paid!.id, { cents: 1000, via: 'manual' })

    expect(await openRequestsForMatching(SERVICE)).toEqual([
      { id: open!.id, reference: open!.reference, amountCents: 1000, payerName: 'Anna Müller' }
    ])
    expect(await openRequestsForMatching('another-payee')).toEqual([])
  })
})

describe('markPaid', () => {
  it('applies a source once and ignores the same source again', async () => {
    const [request] = await createPaymentRequests(SERVICE, [input()])

    expect(await markPaid(request!.id, { cents: 400, via: 'bank', source: 'tx-1' })).toBe(true)
    expect(await markPaid(request!.id, { cents: 400, via: 'bank', source: 'tx-1' })).toBe(false)

    const stored = await getPaymentRequest(request!.id)
    expect(stored!.paidCents).toBe(400)
    expect(stored!.status).toBe('open')
  })

  it('counts partial payments once each, even when the first is redelivered', async () => {
    const [request] = await createPaymentRequests(SERVICE, [input()])

    expect(await markPaid(request!.id, { cents: 300, via: 'bank', source: 'tx-1' })).toBe(true)
    expect(await markPaid(request!.id, { cents: 300, via: 'bank', source: 'tx-2' })).toBe(true)
    expect(await markPaid(request!.id, { cents: 300, via: 'bank', source: 'tx-1' })).toBe(false)

    const stored = await getPaymentRequest(request!.id)
    expect(stored!.paidCents).toBe(600)
    expect(stored!.status).toBe('open')
  })

  it('keeps a partial payment open and flips to paid with the rest', async () => {
    const [request] = await createPaymentRequests(SERVICE, [input()])

    await markPaid(request!.id, { cents: 400, via: 'bank', source: 'tx-1' })
    expect((await getPaymentRequest(request!.id))!.status).toBe('open')

    await markPaid(request!.id, { cents: 600, via: 'bank', source: 'tx-2' })
    const stored = await getPaymentRequest(request!.id)

    expect(stored!.paidCents).toBe(1000)
    expect(stored!.status).toBe('paid')
    expect(stored!.paidVia).toBe('bank')
    expect(stored!.paidAt).toBeInstanceOf(Date)
  })

  it('does not flip to paid when one payment alone is below the amount', async () => {
    const [request] = await createPaymentRequests(SERVICE, [input()])

    await markPaid(request!.id, { cents: 600, via: 'bank', source: 'tx-1' })

    const stored = await getPaymentRequest(request!.id)
    expect(stored!.paidCents).toBe(600)
    expect(stored!.status).toBe('open')
  })

  it('does not apply to a paid request', async () => {
    const [request] = await createPaymentRequests(SERVICE, [input()])
    await markPaid(request!.id, { cents: 1000, via: 'bank', source: 'tx-1' })

    expect(await markPaid(request!.id, { cents: 100, via: 'bank', source: 'tx-2' })).toBe(false)
    expect((await getPaymentRequest(request!.id))!.paidCents).toBe(1000)
  })

  it('does not apply to a cancelled request', async () => {
    const [request] = await createPaymentRequests(SERVICE, [input()])
    await cancelPaymentRequest(request!.id)

    expect(await markPaid(request!.id, { cents: 1000, via: 'manual' })).toBe(false)
    expect((await getPaymentRequest(request!.id))!.paidCents).toBe(0)
  })

  it('never applies one incoming payment to two requests', async () => {
    const [first] = await createPaymentRequests(SERVICE, [input()])
    const [second] = await createPaymentRequests(SERVICE, [input({ title: 'Other' })])

    expect(await markPaid(first!.id, { cents: 400, via: 'bank', source: 'tx-1' })).toBe(true)
    expect(await markPaid(second!.id, { cents: 400, via: 'bank', source: 'tx-1' })).toBe(false)

    expect((await getPaymentRequest(second!.id))!.paidCents).toBe(0)
  })
})

describe('undo', () => {
  it('clears the paid fields and the receipts when a payment is reverted', async () => {
    const [request] = await createPaymentRequests(SERVICE, [input()])
    await markPaid(request!.id, { cents: 1000, via: 'bank', source: 'tx-1' })

    const reverted = await markUnpaid(request!.id)

    expect(reverted).toMatchObject({ status: 'open', paidCents: 0, paidAt: null, paidVia: null })
    // The receipt is gone too, so the same transaction can be recorded again
    expect(await markPaid(request!.id, { cents: 1000, via: 'bank', source: 'tx-1' })).toBe(true)
  })

  it('cancels a request and records a send', async () => {
    const [request] = await createPaymentRequests(SERVICE, [input()])

    expect((await markSent(request!.id))!.sentAt).toBeInstanceOf(Date)
    expect((await cancelPaymentRequest(request!.id))!.status).toBe('cancelled')
    expect((await cancelPaymentRequest('missing'))).toBeUndefined()
  })
})

describe('removing the payee service', () => {
  it('keeps the payment records', async () => {
    const [request] = await createPaymentRequests(SERVICE, [input()])
    const db = await useDb()

    await db.delete(services).where(eq(services.id, SERVICE))

    expect(await getPaymentRequest(request!.id)).toMatchObject({ id: request!.id, service: SERVICE })
  })
})
