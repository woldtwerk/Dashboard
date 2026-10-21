import { formatIban } from './iban'
import { formatMoney } from './money'
import { paypalPaymentUrl, parsePaypalTarget } from './paypal'
import type { PayeeDetails } from './types/payments'
import { weroPaymentUrl } from './wero'

export interface PaymentMailRequest {
  title: string
  reference: string
  amountCents: number
  payerName: string
}

/** German plain-text request: amount and reference, then every way to pay. */
export function paymentRequestMail(request: PaymentMailRequest, payee: PayeeDetails): { subject: string, text: string } {
  const firstName = request.payerName.trim().split(/\s+/)[0] ?? ''
  // A title may come from a workflow; line breaks in a subject would start a header
  const title = request.title.replace(/[\r\n]+/g, ' ').trim()
  const lines = [
    firstName ? `Hallo ${firstName},` : 'Hallo,',
    '',
    'ich möchte dich um folgende Zahlung bitten:',
    '',
    title,
    `Betrag: ${formatMoney(request.amountCents)}`,
    `Referenz: ${request.reference}`,
    ''
  ]

  if (payee.paypal) {
    lines.push(
      'Per PayPal:',
      paypalPaymentUrl(payee.paypal, request.amountCents)
    )
    if (parsePaypalTarget(payee.paypal).kind === 'code') {
      // A personal code has no amount form, so the payer enters it in PayPal
      lines.push(`Betrag bitte selbst eintragen: ${formatMoney(request.amountCents)}`)
    }
    lines.push(`Bitte gib die Referenz ${request.reference} in der PayPal-Notiz an.`, '')
  }

  if (payee.iban) {
    lines.push(
      'Per Überweisung:',
      `Empfänger: ${payee.holder}`,
      `IBAN: ${formatIban(payee.iban)}`
    )
    if (payee.bic) {
      lines.push(`BIC: ${payee.bic}`)
    }
    lines.push(`Verwendungszweck: ${request.reference}`, '')
  }

  if (payee.wero) {
    lines.push(`Per Wero: ${weroPaymentUrl(payee.wero, request.amountCents)}`, '')
  }

  lines.push('Vielen Dank!', payee.holder)

  return {
    subject: `Zahlungsanfrage: ${title} (${request.reference})`,
    text: lines.join('\n')
  }
}
