import { z } from 'zod'
import { EPC_MAX_AMOUNT_CENTS } from '../../shared/epc-qr'

export const paymentStatusSchema = z.enum(['open', 'paid', 'cancelled'])

export const paymentListQuerySchema = z.object({
  status: paymentStatusSchema.optional(),
  service: z.string().min(1).optional()
})

export const paymentPayerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().max(320).optional(),
  /** Contact the payer was picked from */
  contact: z.object({
    service: z.string().min(1).optional(),
    uid: z.string().min(1).max(512)
  }).optional()
})

const amountSchema = z.number().int().positive().max(EPC_MAX_AMOUNT_CENTS)

const createBase = {
  service: z.string().min(1),
  title: z.string().trim().min(1).max(200).regex(/^[^\r\n]*$/, 'The title must be one line'),
  /** Mail the requests right after creating them; a failed send keeps the request */
  send: z.boolean().default(false)
}

const singlePaymentSchema = z.object({
  ...createBase,
  payer: paymentPayerSchema,
  amountCents: amountSchema
})

const splitPaymentSchema = z.object({
  ...createBase,
  totalCents: amountSchema,
  shares: z.number().int().min(1).max(100),
  payers: z.array(paymentPayerSchema).min(1).max(100)
}).refine(input => input.payers.length <= input.shares, {
  message: 'There cannot be more payers than shares',
  path: ['payers']
})

export const paymentCreateBodySchema = z.union([singlePaymentSchema, splitPaymentSchema])

export const paymentPaidBodySchema = z.object({
  /** Defaults to what is still missing on the request */
  cents: amountSchema.optional()
}).default({})
