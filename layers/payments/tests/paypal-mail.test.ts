import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parsePaypalReceivedMail } from '../shared/paypal-mail'

/** An anonymized PayPal "You've got money" mail, as PayPal sends it: HTML only */
const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/paypal-received-en.html', import.meta.url)), 'utf8')

/** The one row that carries the payer's note, so a variant can drop it cleanly */
const NOTE_ROW = /\s*<table id="cartDetails"><tbody><tr>\s*<td width="45%">[\s\S]*?<\/tr><\/tbody><\/table>/

/** The same mail in German, with the labels PayPal.de uses */
const GERMAN = FIXTURE
  .replace('You&#x27;ve got money', 'Sie haben Geld erhalten')
  .replace('Max Mustermann, you received 7,00 € EUR', 'Max Mustermann, Sie haben 7,00 € EUR erhalten')
  .replace('Erika Musterfrau has sent you 7,00 € EUR', 'Erika Musterfrau hat Ihnen 7,00 € EUR gesendet')
  .replace('Transaction Details', 'Transaktionsdetails')
  .replace('<strong>Transaction ID</strong>', '<strong>Transaktionscode</strong>')
  .replace('<strong>Amount received</strong>', '<strong>Erhaltener Betrag</strong>')
  .replace('Note from Erika Musterfrau', 'Mitteilung von Erika Musterfrau')

describe('parsePaypalReceivedMail', () => {
  it.each([
    {
      branch: 'the real mail',
      mail: { subject: 'You\'ve got money', html: FIXTURE },
      expected: {
        amountCents: 700,
        payerName: 'Erika Musterfrau',
        note: 'Chinapfanne',
        transactionId: '1AB23456CD789012E'
      }
    },
    {
      branch: 'a German mail with the same layout',
      mail: { subject: 'Sie haben Geld erhalten', html: GERMAN },
      expected: {
        amountCents: 700,
        payerName: 'Erika Musterfrau',
        note: 'Chinapfanne',
        transactionId: '1AB23456CD789012E'
      }
    },
    {
      branch: 'a mail without a note',
      mail: { subject: 'You\'ve got money', html: FIXTURE.replace(NOTE_ROW, '') },
      expected: {
        amountCents: 700,
        payerName: 'Erika Musterfrau',
        transactionId: '1AB23456CD789012E'
      }
    },
    {
      branch: 'a transaction id that is not PayPal\'s format',
      mail: { subject: 'You\'ve got money', html: FIXTURE.replaceAll('1AB23456CD789012E', '1ab23456cd789012e') },
      expected: {
        amountCents: 700,
        payerName: 'Erika Musterfrau',
        note: 'Chinapfanne'
      }
    },
    {
      branch: 'a text-only mail',
      mail: {
        subject: 'Sie haben Geld erhalten',
        text: [
          'Erika Musterfrau hat Ihnen 7,00 € EUR gesendet',
          'Erhaltener Betrag',
          '7,00 € EUR',
          'Mitteilung von Erika Musterfrau',
          'Chinapfanne',
          'Transaktionscode',
          '1AB23456CD789012E'
        ].join('\n')
      },
      expected: {
        amountCents: 700,
        payerName: 'Erika Musterfrau',
        note: 'Chinapfanne',
        transactionId: '1AB23456CD789012E'
      }
    }
  ])('reads $branch', ({ mail, expected }) => {
    expect(parsePaypalReceivedMail(mail)).toEqual(expected)
  })

  it('caps a long note at 500 characters', () => {
    const html = FIXTURE.replace('Chinapfanne', 'x'.repeat(700))

    expect(parsePaypalReceivedMail({ subject: 'You\'ve got money', html })?.note).toHaveLength(500)
  })

  it.each([
    {
      branch: 'an amount row that contradicts the headline',
      mail: {
        subject: 'You\'ve got money',
        html: FIXTURE.replace('<td align="right">7,00 € EUR</td>', '<td align="right">8,00 € EUR</td>')
      }
    },
    {
      branch: 'a payment the account sent',
      mail: {
        subject: 'You sent a payment',
        html: FIXTURE
          .replace('You&#x27;ve got money', 'You sent a payment')
          .replace('Erika Musterfrau has sent you 7,00 € EUR', 'You sent Erika Musterfrau 7,00 € EUR')
      }
    },
    {
      branch: 'a refund',
      mail: {
        subject: 'You\'ve got money',
        html: FIXTURE.replace(
          'Erika Musterfrau has sent you 7,00 € EUR',
          'Erika Musterfrau has sent you 7,00 € EUR as a refund'
        )
      }
    },
    {
      branch: 'a mail without the payment sentence',
      mail: {
        subject: 'You\'ve got money',
        text: 'Hello, Max Mustermann\n\nYour PayPal account is ready for the next payment.'
      }
    }
  ])('rejects $branch', ({ mail }) => {
    expect(parsePaypalReceivedMail(mail)).toBeUndefined()
  })
})
