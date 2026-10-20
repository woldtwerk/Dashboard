import { createError } from 'nuxt/server'
import { resolveSenderAddress } from '../../../mail/server/utils/mail-identity'
import { sendMail } from '../../../mail/server/utils/mail-send'
import { paymentRequestMail } from '../../shared/mail'
import type { PaymentRequestRow } from '../db/schema'
import { usePayee } from './payee'
import { getPaymentRequest, markSent } from './payment-requests'

/**
 * Sends the request mail from the payee's mail account and records the send.
 * The request already exists, so a refused or failed send changes nothing but
 * the error the caller reports.
 */
export async function sendPaymentRequest(id: string): Promise<PaymentRequestRow> {
  const request = await getPaymentRequest(id)
  if (!request) {
    throw createError({ status: 404, statusText: 'Payment request not found' })
  }
  if (!request.payerEmail) {
    throw createError({ status: 400, statusText: 'The payer has no email address' })
  }
  if (request.status !== 'open') {
    throw createError({ status: 409, statusText: 'Only open payment requests can be sent' })
  }

  const payee = await usePayee(request.service)
  const mail = paymentRequestMail({
    title: request.title,
    reference: request.reference,
    amountCents: request.amountCents,
    payerName: request.payerName
  }, payee)

  const provider = await useMailProvider(payee.mailService)
  const sender = await resolveSenderAddress(payee.mailService)
  if (!sender.ok) {
    throw createError({ status: sender.status, statusText: sender.error })
  }

  const result = await sendMail({
    to: [{ name: request.payerName, address: request.payerEmail }],
    cc: [],
    bcc: [],
    subject: mail.subject,
    text: mail.text,
    from: sender.address
  }, undefined, {
    provider,
    from: { address: sender.address },
    publish: () => publishDomainEvent({ domain: 'mail', service: payee.mailService, type: 'changed', resource: 'Sent' }),
    logger: useServiceLogger('mail', payee.mailService)
  })

  if (result.status !== 200) {
    throw createError({ status: result.status, statusText: result.error })
  }

  const sent = await markSent(id)
  if (!sent) {
    throw createError({ status: 404, statusText: 'Payment request not found' })
  }
  return sent
}
