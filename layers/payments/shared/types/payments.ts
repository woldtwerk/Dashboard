/** The status of a payment request; paid means the full amount arrived. */
export type PaymentStatus = 'open' | 'paid' | 'cancelled'

/** How an incoming payment was recorded. */
export type PaymentMethod = 'manual' | 'bank' | 'paypal' | 'wero' | 'crypto'

/** A payment request as the API and the UI use it; dates are ISO strings in JSON. */
export interface PaymentRequest {
  id: string
  /** Payee service id */
  service: string
  reference: string
  title: string
  amountCents: number
  currency: string
  payerName: string
  payerEmail: string | null
  contactService: string | null
  contactUid: string | null
  batchId: string | null
  status: PaymentStatus
  paidCents: number
  paidAt: string | null
  paidVia: PaymentMethod | null
  sentAt: string | null
  createdAt: string
  origin: string | null
  /**
   * Resolved by the list API from the configured payee services; null when the
   * service was removed, in which case the client shows a placeholder.
   */
  payeeName?: string | null
}

/** The normalized payee settings from the `payee` connector. */
export interface PayeeDetails {
  holder: string
  /** Normalized, unformatted; absent when the payee takes no bank transfers */
  iban?: string
  /** Only meaningful together with an IBAN */
  bic?: string
  /** A PayPal.Me name or the id of a personal PayPal code */
  paypal?: string
  /** The share token out of the payee's Wero QR */
  wero?: string
  /** Mail service id the request is sent from */
  mailService: string
}

/**
 * What the QR endpoint returns; the client renders each entry as an SVG.
 * A method is only present when the payee configured it.
 */
export interface PaymentQrPayload {
  epc?: string
  paypal?: string
  wero?: string
}

/** A request that was created but whose mail could not be sent. */
export interface PaymentSendError {
  id: string
  error: string
}

export interface PaymentCreateResponse {
  requests: PaymentRequest[]
  errors: PaymentSendError[]
}
