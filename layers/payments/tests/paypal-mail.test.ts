import { describe, expect, it } from 'vitest'
import { parsePaypalReceivedMail } from '../shared/paypal-mail'

describe('parsePaypalReceivedMail', () => {
  it.each([
    {
      branch: 'a German amount sentence',
      subject: 'Sie haben Geld erhalten',
      text: 'Hallo Max,\n\nAnna Müller hat Ihnen 2,83 € EUR gesendet.',
      expected: { amountCents: 283, payerName: 'Anna Müller' }
    },
    {
      branch: 'a German payment sentence with a thousands amount',
      subject: 'Sie haben eine Zahlung erhalten',
      text: 'Anna Müller hat Ihnen eine Zahlung über 1.234,56 € EUR gesendet.',
      expected: { amountCents: 123456, payerName: 'Anna Müller' }
    },
    {
      branch: 'an English money sentence',
      subject: 'You\'ve got money',
      text: 'Anna Mueller sent you €2.83 EUR',
      expected: { amountCents: 283, payerName: 'Anna Mueller' }
    },
    {
      branch: 'an English payment sentence',
      subject: 'You received a payment',
      text: 'Anna Mueller sent you a payment of €1,234.56 EUR',
      expected: { amountCents: 123456, payerName: 'Anna Mueller' }
    }
  ])('reads $branch', ({ subject, text, expected }) => {
    expect(parsePaypalReceivedMail({ subject, text })).toEqual(expected)
  })

  it('reads the note after a label, up to the next blank line', () => {
    const mail = {
      subject: 'Sie haben Geld erhalten',
      text: [
        'Anna Müller hat Ihnen 2,83 € EUR gesendet.',
        '',
        'Mitteilung',
        'AM-ABC123',
        'Abendessen',
        '',
        'Dieser Text steht nicht mehr in der Mitteilung.'
      ].join('\n')
    }

    expect(parsePaypalReceivedMail(mail)).toEqual({
      amountCents: 283,
      payerName: 'Anna Müller',
      note: 'AM-ABC123\nAbendessen'
    })
  })

  it('caps a long note at 500 characters', () => {
    const mail = {
      subject: 'You\'ve got money',
      text: `Anna Mueller sent you €2.83 EUR\n\nNote\n${'x'.repeat(700)}`
    }

    expect(parsePaypalReceivedMail(mail)?.note).toHaveLength(500)
  })

  it.each([
    {
      branch: 'a payment the account sent',
      subject: 'Sie haben eine Zahlung gesendet',
      text: 'Sie haben Anna Müller 2,83 € EUR gesendet.'
    },
    {
      branch: 'an English sent payment',
      subject: 'You sent a payment',
      text: 'You sent Anna Mueller €2.83 EUR.'
    },
    {
      branch: 'a German refund',
      subject: 'Sie haben eine Rückzahlung erhalten',
      text: 'Anna Müller hat Ihnen 2,83 € EUR gesendet.'
    },
    {
      branch: 'an English refund',
      subject: 'You\'ve got money',
      text: 'Anna Mueller sent you €2.83 EUR as a refund.'
    },
    {
      branch: 'a newsletter',
      subject: 'Neu bei PayPal: Tipps für dein Konto',
      text: 'Entdecke die neuen Funktionen in deiner PayPal-App.'
    },
    {
      branch: 'a received subject without a payment sentence',
      subject: 'Sie haben Geld erhalten',
      text: 'Es gibt Neuigkeiten in Ihrem Konto.'
    }
  ])('rejects $branch', ({ subject, text }) => {
    expect(parsePaypalReceivedMail({ subject, text })).toBeUndefined()
  })
})
