import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { listPaymentRequests, toPaymentRequest } from '../../utils/payment-requests'
import { paymentListQuerySchema } from '../../utils/payments-schema'

export default defineEventHandler(async (event) => {
  const filter = await getValidatedQuery(event, paymentListQuerySchema)
  const [rows, services] = await Promise.all([
    listPaymentRequests(filter),
    listServices('payments')
  ])
  const payeeNames = new Map(services.map(service => [service.id, service.name]))

  return rows.map(row => ({
    ...toPaymentRequest(row),
    // A removed payee keeps its requests; the client shows a placeholder
    payeeName: payeeNames.get(row.service) ?? null
  }))
})
