import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { createReference } from '../../shared/reference'
import type { OpenRequest } from '../../shared/match'
import type { PaymentMethod, PaymentRequest, PaymentStatus } from '../../shared/types/payments'
import { paymentReceipts, paymentRequests } from '../db/schema'
import type { PaymentRequestRow } from '../db/schema'

export interface PaymentRequestInput {
  title: string
  amountCents: number
  payerName: string
  payerEmail?: string
  contactService?: string
  contactUid?: string
  currency?: string
}

export interface CreatePaymentRequestsOptions {
  /** Shared by requests created together in one split */
  batchId?: string
  /** e.g. `workflow:<runId>` */
  origin?: string
  /** Injectable for tests that force a reference collision */
  generateReference?: () => string
}

export interface MarkPaidInput {
  cents: number
  via: PaymentMethod
  /** Bank transaction id or mail key; applying the same one twice is a no-op */
  source?: string
  at?: Date
}

const REFERENCE_ATTEMPTS = 4
const CHANGED_EVENT = { domain: 'payments', type: 'changed' } as const

/** SQLite's unique violation, whether the proxy driver or drizzle wrapped it. */
function isUniqueViolation(error: unknown): boolean {
  const value = error as { code?: string, errcode?: number, errstr?: string, message?: string, cause?: unknown } | undefined
  if (!value) {
    return false
  }
  if (value.errcode === 2067) {
    return true
  }
  if (/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(`${value.message ?? ''} ${value.errstr ?? ''}`)) {
    return true
  }
  return value.cause !== undefined && value.cause !== error ? isUniqueViolation(value.cause) : false
}

/** The messages of the error and its causes, for the column a violation names. */
function errorText(error: unknown): string {
  const value = error as { message?: string, errstr?: string, cause?: unknown } | undefined
  if (!value) {
    return ''
  }
  return [
    value.message,
    value.errstr,
    value.cause !== undefined && value.cause !== error ? errorText(value.cause) : ''
  ].filter(Boolean).join(' ')
}

function isReferenceViolation(error: unknown): boolean {
  return isUniqueViolation(error) && /reference/i.test(errorText(error))
}

async function publishChanged(service: string): Promise<void> {
  await publishDomainEvent({ ...CHANGED_EVENT, service })
}

/**
 * Creates one request per input, generating a unique reference for each. A
 * collision on `reference` — another cluster worker took the same six
 * characters — is retried with a fresh one before the write fails.
 */
export async function createPaymentRequests(
  service: string,
  input: PaymentRequestInput[],
  options: CreatePaymentRequestsOptions = {}
): Promise<PaymentRequestRow[]> {
  const db = await useDb()
  const generate = options.generateReference ?? createReference
  const created: PaymentRequestRow[] = []

  try {
    for (const item of input) {
      if (!Number.isInteger(item.amountCents) || item.amountCents <= 0) {
        throw new Error('The amount must be a positive amount in cents')
      }

      let saved: PaymentRequestRow | undefined
      for (let attempt = 0; attempt < REFERENCE_ATTEMPTS && !saved; attempt++) {
        try {
          const [row] = await db.insert(paymentRequests).values({
            id: randomUUID(),
            service,
            reference: generate(),
            title: item.title,
            amountCents: item.amountCents,
            currency: item.currency ?? 'EUR',
            payerName: item.payerName,
            payerEmail: item.payerEmail ?? null,
            contactService: item.contactService ?? null,
            contactUid: item.contactUid ?? null,
            batchId: options.batchId ?? null,
            status: 'open',
            paidCents: 0,
            createdAt: new Date(),
            origin: options.origin ?? null
          }).returning()

          saved = row
        } catch (error) {
          // Any other unique violation (e.g. the id) is not the reference's fault
          if (!isReferenceViolation(error) || attempt === REFERENCE_ATTEMPTS - 1) {
            throw error
          }
        }
      }

      created.push(saved!)
    }
  } catch (error) {
    // A split must not leave half of its rows behind; a new attempt creates them all
    if (created.length) {
      await db.delete(paymentRequests).where(inArray(paymentRequests.id, created.map(row => row.id)))
    }
    throw error
  }

  if (created.length) {
    await publishChanged(service)
  }

  return created
}

/** Newest first; `status` and `service` narrow the list. */
export async function listPaymentRequests(filter: { status?: PaymentStatus, service?: string } = {}): Promise<PaymentRequestRow[]> {
  const conditions = [
    filter.status ? eq(paymentRequests.status, filter.status) : undefined,
    filter.service ? eq(paymentRequests.service, filter.service) : undefined
  ].filter(condition => condition !== undefined)

  return await (await useDb())
    .select()
    .from(paymentRequests)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(paymentRequests.createdAt))
}

export async function getPaymentRequest(id: string): Promise<PaymentRequestRow | undefined> {
  return await (await useDb()).select().from(paymentRequests).where(eq(paymentRequests.id, id)).get()
}

/** The API shape: dates as ISO strings, the way JSON delivers them anyway. */
export function toPaymentRequest(row: PaymentRequestRow): PaymentRequest {
  return {
    ...row,
    paidAt: row.paidAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  }
}

/**
 * Records an incoming payment on an open request. One transaction writes the
 * receipt and adds the cents, so a partial payment keeps the request open until
 * the full amount is there; the status flips to paid in the same statement. A
 * source already recorded for this payee — or claimed by another request — is a
 * no-op returning false, which makes a redelivered bank or mail payment safe.
 * Paid and cancelled requests are closed to further payments and return false.
 */
export async function markPaid(id: string, input: MarkPaidInput): Promise<boolean> {
  if (!Number.isInteger(input.cents) || input.cents <= 0) {
    throw new Error('The amount must be a positive amount in cents')
  }

  const db = await useDb()
  // IMMEDIATE takes the write lock before the status is read, so a concurrent
  // worker cannot close the request between the check and the receipt insert.
  const service = await db.transaction(async (tx) => {
    const existing = await tx.select({ service: paymentRequests.service, status: paymentRequests.status })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, id))
      .get()

    if (!existing || existing.status !== 'open') {
      return false
    }

    try {
      await tx.insert(paymentReceipts).values({
        id: randomUUID(),
        requestId: id,
        service: existing.service,
        source: input.source ?? null,
        cents: input.cents,
        via: input.via,
        receivedAt: input.at ?? new Date()
      })
    } catch (error) {
      // The same source was already applied; nothing else in this transaction changed
      if (isUniqueViolation(error)) {
        return false
      }
      throw error
    }

    const [updated] = await tx.update(paymentRequests)
      .set({
        paidCents: sql`${paymentRequests.paidCents} + ${input.cents}`,
        paidAt: input.at ?? new Date(),
        paidVia: input.via,
        status: sql`case when ${paymentRequests.paidCents} + ${input.cents} >= ${paymentRequests.amountCents} then 'paid' else ${paymentRequests.status} end`
      })
      .where(and(eq(paymentRequests.id, id), eq(paymentRequests.status, 'open')))
      .returning({ service: paymentRequests.service })

    if (!updated) {
      // Roll the receipt back rather than keep a payment that was not applied
      throw new Error('The payment request changed while recording the payment')
    }

    return updated.service
  }, { behavior: 'immediate' })

  if (!service) {
    return false
  }

  await publishChanged(service)
  return true
}

/** Undo of a manual or automatic payment: open again, nothing paid and no receipts left. */
export async function markUnpaid(id: string): Promise<PaymentRequestRow | undefined> {
  const db = await useDb()
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(paymentRequests)
      .set({ status: 'open', paidCents: 0, paidAt: null, paidVia: null })
      .where(eq(paymentRequests.id, id))
      .returning()

    if (!row) {
      return undefined
    }

    await tx.delete(paymentReceipts).where(eq(paymentReceipts.requestId, id))
    return row
  }, { behavior: 'immediate' })

  if (updated) {
    await publishChanged(updated.service)
  }
  return updated
}

export async function cancelPaymentRequest(id: string): Promise<PaymentRequestRow | undefined> {
  const [updated] = await (await useDb()).update(paymentRequests)
    .set({ status: 'cancelled' })
    .where(eq(paymentRequests.id, id))
    .returning()

  if (updated) {
    await publishChanged(updated.service)
  }
  return updated
}

/**
 * The request a payment source already landed on. A redelivered bank or mail
 * payment is recognized by it before any matching, so a closed request is not
 * reported as an unmatched payment.
 */
export async function requestForPaymentSource(service: string, source: string): Promise<PaymentRequestRow | undefined> {
  const row = await (await useDb())
    .select({ request: paymentRequests })
    .from(paymentReceipts)
    .innerJoin(paymentRequests, eq(paymentReceipts.requestId, paymentRequests.id))
    .where(and(eq(paymentReceipts.service, service), eq(paymentReceipts.source, source)))
    .get()

  return row?.request
}

/** Requests the bank/PayPal matching may still close, optionally of one payee. */
export async function openRequestsForMatching(service?: string): Promise<OpenRequest[]> {
  const conditions = [
    eq(paymentRequests.status, 'open'),
    service ? eq(paymentRequests.service, service) : undefined
  ].filter(condition => condition !== undefined)

  return await (await useDb())
    .select({
      id: paymentRequests.id,
      reference: paymentRequests.reference,
      amountCents: paymentRequests.amountCents,
      payerName: paymentRequests.payerName
    })
    .from(paymentRequests)
    .where(and(...conditions))
}

export async function markSent(id: string): Promise<PaymentRequestRow | undefined> {
  const [updated] = await (await useDb()).update(paymentRequests)
    .set({ sentAt: new Date() })
    .where(eq(paymentRequests.id, id))
    .returning()

  if (updated) {
    await publishChanged(updated.service)
  }
  return updated
}
