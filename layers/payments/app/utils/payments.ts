import type { DomainEvent } from '#layers/core/shared/types/domain-events'
import type { PaymentRequest, PaymentStatus } from '#layers/payments/shared/types/payments'

export const PAYMENT_STATUSES: readonly PaymentStatus[] = ['open', 'paid', 'cancelled']

/** `all` is a view over every status; it is stored explicitly in the URL. */
export type PaymentStatusFilter = PaymentStatus | 'all'

/**
 * The list filter from the URL. A missing or unknown status shows the open
 * requests, the page's default.
 */
export function paymentStatusFromQuery(query: Record<string, unknown>): PaymentStatusFilter {
  const value = query.status
  if (value === 'all') {
    return 'all'
  }
  return typeof value === 'string' && PAYMENT_STATUSES.includes(value as PaymentStatus)
    ? value as PaymentStatus
    : 'open'
}

/** The URL patch for a filter; the default `open` leaves the URL clean. */
export function paymentStatusToQuery(status: PaymentStatusFilter): { status?: string } {
  return status === 'open' ? { status: undefined } : { status }
}

/** Whether an event asks the payments page to reload its list. */
export function paymentsRefreshFor(event: DomainEvent): boolean {
  return event.domain === 'payments' && event.type === 'changed'
}

/**
 * The row as it looks after recording a payment, before the server answered.
 * Only this row changes; the list handed in stays untouched, so the page can
 * restore it when the request fails.
 */
export function markPaidOptimistically(
  list: PaymentRequest[],
  id: string,
  cents: number,
  at = new Date()
): PaymentRequest[] {
  return list.map((request) => {
    if (request.id !== id) {
      return request
    }

    const paidCents = request.paidCents + cents
    return {
      ...request,
      paidCents,
      status: paidCents >= request.amountCents ? 'paid' : request.status,
      paidAt: at.toISOString(),
      paidVia: 'manual'
    }
  })
}

export function markUnpaidOptimistically(list: PaymentRequest[], id: string): PaymentRequest[] {
  return list.map(request => request.id === id
    ? { ...request, status: 'open', paidCents: 0, paidAt: null, paidVia: null }
    : request)
}

export function cancelOptimistically(list: PaymentRequest[], id: string): PaymentRequest[] {
  return list.map(request => request.id === id ? { ...request, status: 'cancelled' } : request)
}

/**
 * Puts one row back after its request failed. Only that row is restored, so a
 * refresh that ran while the request was in flight keeps the other rows.
 */
export function restorePaymentRequest(list: PaymentRequest[], previous: PaymentRequest, id: string): PaymentRequest[] {
  return list.map(request => request.id === id ? previous : request)
}

/** The server's message for a failed fetch, or the caller's fallback. */
export function paymentErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { statusMessage?: string, message?: string } } | undefined)?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : fallback)
}
