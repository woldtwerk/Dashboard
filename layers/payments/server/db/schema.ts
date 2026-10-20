import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * One payment request (EUR) with its unique reference and what has arrived so
 * far. `paid_cents` can stay below `amount_cents` when a bank transfer or a
 * PayPal payment only covered part of it; the status only flips to paid once
 * the full amount is there.
 *
 * No foreign key to `services`: removing a payee is a settings change, not a
 * reason for the invoice history to disappear. The list API resolves the payee
 * name and shows a removed one as unknown.
 */
export const paymentRequests = sqliteTable('payment_requests', {
  id: text('id').primaryKey(),
  /** Payee service id; may point at a removed service */
  service: text('service').notNull(),
  reference: text('reference').notNull().unique(),
  title: text('title').notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('EUR'),
  payerName: text('payer_name').notNull(),
  payerEmail: text('payer_email'),
  /** Contact the payer was picked from, when any */
  contactService: text('contact_service'),
  contactUid: text('contact_uid'),
  /** Requests created together by one split share this id */
  batchId: text('batch_id'),
  status: text('status', { enum: ['open', 'paid', 'cancelled'] }).notNull(),
  paidCents: integer('paid_cents').notNull().default(0),
  paidAt: integer('paid_at', { mode: 'timestamp_ms' }),
  paidVia: text('paid_via', { enum: ['manual', 'bank', 'paypal', 'wero', 'crypto'] }),
  sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  /** e.g. `workflow:<runId>` */
  origin: text('origin')
}, table => [
  index('payment_requests_service_status_idx').on(table.service, table.status),
  index('payment_requests_batch_id_idx').on(table.batchId)
])

/**
 * Every incoming payment applied to a request, one row each. The unique
 * `(service, source)` keeps a redelivered bank or mail payment from being
 * applied twice; SQLite treats NULLs as distinct, so manual payments (no
 * source) can be recorded as often as needed. The request keeps the sum in
 * `paid_cents`; undo drops these rows together with the reset.
 */
export const paymentReceipts = sqliteTable('payment_receipts', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => paymentRequests.id, { onDelete: 'cascade' }),
  service: text('service').notNull(),
  /** Bank transaction id or mail key; null for a manual payment */
  source: text('source'),
  cents: integer('cents').notNull(),
  via: text('via', { enum: ['manual', 'bank', 'paypal', 'wero', 'crypto'] }).notNull(),
  receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull()
}, table => [
  uniqueIndex('payment_receipts_service_source_idx').on(table.service, table.source),
  index('payment_receipts_request_id_idx').on(table.requestId)
])

export type PaymentRequestRow = typeof paymentRequests.$inferSelect
export type PaymentReceiptRow = typeof paymentReceipts.$inferSelect
