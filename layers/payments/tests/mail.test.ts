import { describe, expect, it } from 'vitest'
import { paymentRequestMail } from '../shared/mail'
import { formatMoney } from '../shared/money'
import { paypalPaymentUrl } from '../shared/paypal'
import type { PayeeDetails } from '../shared/types/payments'
import { weroPaymentUrl } from '../shared/wero'

const payee: PayeeDetails = {
  holder: 'Max Mustermann',
  mailService: 'mail-1'
}

const request = {
  title: 'Dinner',
  reference: 'AM-7K3Q9X',
  amountCents: 1799,
  payerName: 'Anna Müller'
}

describe('paymentRequestMail', () => {
  it('sends only the PayPal link when that is the only method', () => {
    const { text } = paymentRequestMail(request, { ...payee, paypal: 'jane-doe' })

    expect(text).toContain(paypalPaymentUrl('jane-doe', request.amountCents))
    expect(text).not.toContain('IBAN:')
    expect(text).not.toContain('Per Wero:')
  })

  it('sends the amount separately for a personal PayPal code', () => {
    const { text } = paymentRequestMail(request, { ...payee, paypal: '3ZAD8FWS67RUJ' })

    expect(text).toContain(paypalPaymentUrl('3ZAD8FWS67RUJ', request.amountCents))
    expect(text).toContain(`Betrag bitte selbst eintragen: ${formatMoney(request.amountCents)}`)
  })

  it('sends only the Wero link when that is the only method', () => {
    const { text } = paymentRequestMail(request, { ...payee, wero: 'd6xY21Hybs' })

    expect(text).toContain(weroPaymentUrl('d6xY21Hybs', request.amountCents))
    expect(text).not.toContain('IBAN:')
    expect(text).not.toContain('Per PayPal:')
  })

  it('sends only the bank block when there is just an IBAN', () => {
    const { text } = paymentRequestMail(request, { ...payee, iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' })

    expect(text).toContain('IBAN: DE89 3704 0044 0532 0130 00')
    expect(text).toContain('BIC: COBADEFFXXX')
    expect(text).not.toContain('Per PayPal:')
    expect(text).not.toContain('Per Wero:')
  })

  it('sends every configured method together', () => {
    const { text } = paymentRequestMail(request, {
      ...payee,
      iban: 'DE89370400440532013000',
      paypal: 'jane-doe',
      wero: 'd6xY21Hybs'
    })

    expect(text).toContain(paypalPaymentUrl('jane-doe', request.amountCents))
    expect(text).toContain(weroPaymentUrl('d6xY21Hybs', request.amountCents))
    expect(text).toContain('IBAN: DE89 3704 0044 0532 0130 00')
  })

  it('keeps a line break in a title out of the subject', () => {
    const { subject } = paymentRequestMail({ ...request, title: 'Dinner\r\nBcc: other@example.com' }, payee)

    expect(subject).not.toMatch(/[\r\n]/)
  })
})
