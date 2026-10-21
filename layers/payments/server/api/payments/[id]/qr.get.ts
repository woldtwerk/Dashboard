import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { epcQrPayload } from '../../../../shared/epc-qr'
import { paypalPaymentUrl } from '../../../../shared/paypal'
import type { PaymentQrPayload } from '../../../../shared/types/payments'
import { weroPaymentUrl } from '../../../../shared/wero'
import { getPaymentRequest } from '../../../utils/payment-requests'
import { usePayee } from '../../../utils/payee'

/**
 * The payloads the client renders as SVGs; prefetched when the user hovers a
 * row. A method is only present when the payee configured it, and each link is
 * built from the stored identifier here, never taken from the client.
 */
export default defineEventHandler(async (event): Promise<PaymentQrPayload> => {
  const request = await getPaymentRequest(getRouterParam(event, 'id')!)
  if (!request) {
    throw createError({ status: 404, statusText: 'Payment request not found' })
  }

  const payee = await usePayee(request.service)

  return {
    ...(payee.iban
      ? {
          epc: epcQrPayload({
            name: payee.holder,
            iban: payee.iban,
            bic: payee.bic,
            amountCents: request.amountCents,
            remittance: request.reference
          })
        }
      : {}),
    ...(payee.paypal ? { paypal: paypalPaymentUrl(payee.paypal, request.amountCents) } : {}),
    ...(payee.wero ? { wero: weroPaymentUrl(payee.wero, request.amountCents) } : {})
  }
})
