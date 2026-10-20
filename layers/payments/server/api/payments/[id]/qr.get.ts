import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { epcQrPayload } from '../../../../shared/epc-qr'
import { paypalMeLink } from '../../../../shared/paypal'
import type { PaymentQrPayload } from '../../../../shared/types/payments'
import { getPaymentRequest } from '../../../utils/payment-requests'
import { usePayee } from '../../../utils/payee'

/** The payloads the client renders as SVGs; prefetched when the user hovers a row. */
export default defineEventHandler(async (event): Promise<PaymentQrPayload> => {
  const request = await getPaymentRequest(getRouterParam(event, 'id')!)
  if (!request) {
    throw createError({ status: 404, statusText: 'Payment request not found' })
  }

  const payee = await usePayee(request.service)
  const epc = epcQrPayload({
    name: payee.holder,
    iban: payee.iban,
    bic: payee.bic,
    amountCents: request.amountCents,
    remittance: request.reference
  })

  return {
    epc,
    ...(payee.paypalMe ? { paypal: paypalMeLink(payee.paypalMe, request.amountCents) } : {})
  }
})
