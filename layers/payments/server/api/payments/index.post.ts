import { randomUUID } from 'node:crypto'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { splitAmount } from '../../../shared/split'
import type { PaymentCreateResponse, PaymentRequest, PaymentSendError } from '../../../shared/types/payments'
import type { PaymentRequestRow } from '../../db/schema'
import { getPaymentRequest, createPaymentRequests, toPaymentRequest } from '../../utils/payment-requests'
import { paymentCreateBodySchema } from '../../utils/payments-schema'

function sendErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not send the payment request'
}

/**
 * Creates one request, or one per payer of a split. A send right away is
 * attempted per request: a failed mail leaves that request created and is
 * reported in `errors`, so the user can fix the address and resend.
 */
export default defineEventHandler(async (event): Promise<PaymentCreateResponse> => {
  const body = await readValidatedBody(event, paymentCreateBodySchema)
  // Reject a service that is not a payee before anything is written
  await usePayee(body.service)

  const inputs = 'payers' in body
    ? (() => {
        const amounts = splitAmount(body.totalCents, body.shares, body.payers.length)
        return body.payers.map((payer, index) => ({
          title: body.title,
          amountCents: amounts[index]!,
          payerName: payer.name,
          payerEmail: payer.email,
          contactService: payer.contact?.service,
          contactUid: payer.contact?.uid
        }))
      })()
    : [{
        title: body.title,
        amountCents: body.amountCents,
        payerName: body.payer.name,
        payerEmail: body.payer.email,
        contactService: body.payer.contact?.service,
        contactUid: body.payer.contact?.uid
      }]

  const created = await createPaymentRequests(body.service, inputs, {
    batchId: 'payers' in body ? randomUUID() : undefined
  })

  const errors: PaymentSendError[] = []
  if (body.send) {
    for (const request of created) {
      try {
        await sendPaymentRequest(request.id)
      } catch (error) {
        errors.push({ id: request.id, error: sendErrorMessage(error) })
      }
    }
  }

  let requests: PaymentRequest[] = created.map(toPaymentRequest)
  if (body.send) {
    const reloaded = await Promise.all(created.map(request => getPaymentRequest(request.id)))
    requests = reloaded
      .filter((request): request is PaymentRequestRow => !!request)
      .map(toPaymentRequest)
  }

  return { requests, errors }
})
