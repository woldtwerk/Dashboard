import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { getPaymentRequest, toPaymentRequest } from '../../utils/payment-requests'

export default defineEventHandler(async (event) => {
  const request = await getPaymentRequest(getRouterParam(event, 'id')!)
  if (!request) {
    throw createError({ status: 404, statusText: 'Payment request not found' })
  }
  return toPaymentRequest(request)
})
