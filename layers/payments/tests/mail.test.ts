import { describe, expect, it } from 'vitest'
import { paymentRequestMail } from '../shared/mail'
import { paypalMeLink } from '../shared/paypal'
import type { PayeeDetails } from '../shared/types/payments'

const payee: PayeeDetails = {
  holder: 'Max Mustermann',
  iban: 'DE89370400440532013000',
  bic: 'COBADEFFXXX',
  mailService: 'mail-1'
}

const request = {
  title: 'Dinner',
  reference: 'AM-7K3Q9X',
  amountCents: 1799,
  payerName: 'Anna Müller'
}

describe('paymentRequestMail', () => {
  it('leaves out PayPal when the payee has no username', () => {
    const { text } = paymentRequestMail(request, payee)

    expect(text).not.toContain('paypal.me')
    expect(text).toContain('Verwendungszweck: AM-7K3Q9X')
  })

  it('adds the PayPal link and the reference hint when configured', () => {
    const { text } = paymentRequestMail(request, { ...payee, paypalMe: 'maxmustermann' })

    expect(text).toContain(paypalMeLink('maxmustermann', request.amountCents))
    expect(text).toContain('AM-7K3Q9X')
  })

  it('leaves out Wero when the payee has no alias', () => {
    expect(paymentRequestMail(request, payee).text).not.toContain('Wero')
  })

  it('shows both PayPal and Wero when both are configured', () => {
    const { text } = paymentRequestMail(request, {
      ...payee,
      paypalMe: 'maxmustermann',
      wero: '+49 170 1234567'
    })

    expect(text).toContain(paypalMeLink('maxmustermann', request.amountCents))
    expect(text).toContain('+49 170 1234567')
  })

  it('keeps a line break in a title out of the subject', () => {
    const { subject } = paymentRequestMail({ ...request, title: 'Dinner\r\nBcc: other@example.com' }, payee)

    expect(subject).not.toMatch(/[\r\n]/)
  })
})
