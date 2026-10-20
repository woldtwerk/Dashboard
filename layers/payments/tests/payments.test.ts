import { describe, expect, it } from 'vitest'
import type { DomainEvent } from '../../core/shared/types/domain-events'
import type { PaymentRequest } from '../shared/types/payments'
import {
  markPaidOptimistically,
  markUnpaidOptimistically,
  paymentStatusFromQuery,
  paymentStatusToQuery,
  paymentsRefreshFor,
  restorePaymentRequest
} from '../app/utils/payments'

function request(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    id: 'a',
    service: 'payee-1',
    reference: 'AM-AAAAAA',
    title: 'Dinner',
    amountCents: 1000,
    currency: 'EUR',
    payerName: 'Anna Müller',
    payerEmail: null,
    contactService: null,
    contactUid: null,
    batchId: null,
    status: 'open',
    paidCents: 0,
    paidAt: null,
    paidVia: null,
    sentAt: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    origin: null,
    ...overrides
  }
}

describe('the status filter', () => {
  it('defaults to open and treats an unknown value as open', () => {
    expect(paymentStatusFromQuery({})).toBe('open')
    expect(paymentStatusFromQuery({ status: 'bogus' })).toBe('open')
    expect(paymentStatusFromQuery({ status: ['paid', 'open'] })).toBe('open')
  })

  it('reads every status and all', () => {
    expect(paymentStatusFromQuery({ status: 'paid' })).toBe('paid')
    expect(paymentStatusFromQuery({ status: 'cancelled' })).toBe('cancelled')
    expect(paymentStatusFromQuery({ status: 'all' })).toBe('all')
  })

  it('keeps the default out of the URL', () => {
    expect(paymentStatusToQuery('open').status).toBeUndefined()
    expect(paymentStatusToQuery('paid')).toEqual({ status: 'paid' })
    expect(paymentStatusToQuery('all')).toEqual({ status: 'all' })
  })
})

describe('paymentsRefreshFor', () => {
  const event = (overrides: Partial<DomainEvent> = {}): DomainEvent => ({
    domain: 'payments',
    service: 'payee-1',
    type: 'changed',
    at: '2026-10-20T10:00:00.000Z',
    ...overrides
  })

  it('refreshes on a change in the payments domain', () => {
    expect(paymentsRefreshFor(event())).toBe(true)
  })

  it('ignores other event types and domains', () => {
    expect(paymentsRefreshFor(event({ type: 'synced' }))).toBe(false)
    expect(paymentsRefreshFor(event({ domain: 'contacts' }))).toBe(false)
  })
})

describe('optimistic payments', () => {
  it.each([
    { name: 'a partial payment', cents: 400, priorCents: 0, status: 'open', paidCents: 400 },
    { name: 'the rest of the amount', cents: 600, priorCents: 400, status: 'paid', paidCents: 1000 },
    { name: 'overpaying', cents: 1200, priorCents: 0, status: 'paid', paidCents: 1200 }
  ])('marks $name', ({ cents, priorCents, status, paidCents }) => {
    const [updated] = markPaidOptimistically([request({ paidCents: priorCents })], 'a', cents)

    expect(updated).toMatchObject({ status, paidCents, paidVia: 'manual' })
    expect(updated!.paidAt).not.toBeNull()
  })

  it('leaves the list it was given intact, so a failed request can restore it', () => {
    const list = [request({ status: 'open', paidCents: 200 })]
    const next = markPaidOptimistically(list, 'a', 300)

    expect(next).not.toBe(list)
    expect(list[0]).toMatchObject({ status: 'open', paidCents: 200 })
    expect(next[0]).toMatchObject({ status: 'open', paidCents: 500 })
  })

  it('clears the paid fields when reverting a payment', () => {
    const [updated] = markUnpaidOptimistically([request({
      status: 'paid',
      paidCents: 1000,
      paidAt: '2026-10-20T10:00:00.000Z',
      paidVia: 'bank'
    })], 'a')

    expect(updated).toMatchObject({ status: 'open', paidCents: 0, paidAt: null, paidVia: null })
  })

  it('restores only the failed row, keeping newer changes to the others', () => {
    const failed = request({ id: 'a', paidCents: 0 })
    const current = [
      request({ id: 'a', paidCents: 400, paidVia: 'bank' }),
      request({ id: 'b', title: 'Renamed meanwhile' })
    ]

    const restored = restorePaymentRequest(current, failed, 'a')

    expect(restored[0]).toBe(failed)
    expect(restored[1]!.title).toBe('Renamed meanwhile')
  })
})
