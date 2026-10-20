import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { markUnpaid, toPaymentRequest } from '../../../utils/payment-requests'

export default defineEventHandler(async (event) => {
  const updated = await markUnpaid(getRouterParam(event, 'id')!)
  if (!updated) {
    throw createError({ status: 404, statusText: 'Payment request not found' })
  }
  return toPaymentRequest(updated)
})
