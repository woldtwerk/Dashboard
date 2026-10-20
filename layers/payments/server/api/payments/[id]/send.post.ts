import { defineEventHandler, getRouterParam } from 'nuxt/server'
import { toPaymentRequest } from '../../../utils/payment-requests'

export default defineEventHandler(async (event) => {
  return toPaymentRequest(await sendPaymentRequest(getRouterParam(event, 'id')!))
})
