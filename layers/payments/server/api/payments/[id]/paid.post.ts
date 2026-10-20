import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { getPaymentRequest, markPaid, toPaymentRequest } from '../../../utils/payment-requests'
import { paymentPaidBodySchema } from '../../../utils/payments-schema'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, paymentPaidBodySchema)
  const request = await getPaymentRequest(id)

  if (!request) {
    throw createError({ status: 404, statusText: 'Payment request not found' })
  }
  if (request.status === 'cancelled') {
    throw createError({ status: 409, statusText: 'A cancelled payment request cannot be marked paid' })
  }

  const remaining = Math.max(request.amountCents - request.paidCents, 0)
  if (remaining > 0) {
    // Nothing given means the open rest; a partial amount stays open on the server
    await markPaid(id, { cents: body.cents ?? remaining, via: 'manual' })
  }

  const updated = await getPaymentRequest(id)
  if (!updated) {
    throw createError({ status: 404, statusText: 'Payment request not found' })
  }
  return toPaymentRequest(updated)
})
