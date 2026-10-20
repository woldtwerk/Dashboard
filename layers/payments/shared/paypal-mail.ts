import { parseMoney } from './money'

export interface PaypalReceivedMail {
  amountCents: number
  payerName: string
  note?: string
}

const RECEIVED_SUBJECTS = [
  /\bSie haben (?:eine Zahlung|Geld) erhalten\b/i,
  /\bYou(?:'ve| have) got money\b/i,
  /\bYou(?:'ve| have)? received (?:a|the) payment\b/i
]

const NOT_RECEIVED_SUBJECTS = [
  /\bSie haben (?:eine Zahlung|Geld) gesendet\b/i,
  /\bYou (?:sent|have sent|'ve sent) (?:a payment|money)\b/i
]

/** A refund is money leaving the account, never a payment to confirm */
const REFUND = /\bRückzahlung\b|\brefund(?:ed)?\b|\bzurückgezahlt\b/i

/** An amount as PayPal writes it, e.g. `2,83 €` or `€2.83` */
const MONEY = String.raw`(?:[0-9][0-9.,\s]*\s?€|€\s?[0-9][0-9.,]*)`

const GERMAN_SENTENCE = new RegExp(
  String.raw`([^\n]{1,120}?)\s+hat Ihnen\s+(?:eine Zahlung (?:über|von)\s+)?(${MONEY})(?:\s*EUR)?\s+gesendet\b`,
  'i'
)

const ENGLISH_SENTENCE = new RegExp(
  String.raw`([^\n]{1,120}?)\s+sent you\s+(?:a payment (?:of|over)\s+)?(${MONEY})(?:\s*EUR)?`,
  'i'
)

const NOTE_LABEL = /^\s*(?:Mitteilung|Nachricht|Note)\s*:?\s*$/i
const NOTE_INLINE = /^\s*(?:Mitteilung|Nachricht|Note)\s*:\s*(.+)$/i

/** The note after a `Mitteilung`/`Nachricht`/`Note` line, up to the next blank line */
function noteFrom(text: string): string | undefined {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')

  for (const [index, line] of lines.entries()) {
    const inline = NOTE_INLINE.exec(line)?.[1]?.trim()
    if (inline) {
      return inline.slice(0, 500)
    }
    if (!NOTE_LABEL.test(line)) {
      continue
    }

    const collected: string[] = []
    for (const next of lines.slice(index + 1)) {
      if (!next.trim()) {
        if (collected.length) {
          break
        }
        continue
      }
      collected.push(next.trim())
    }

    const note = collected.join('\n').trim()
    return note ? note.slice(0, 500) : undefined
  }

  return undefined
}

/**
 * Reads a PayPal "money received" mail: its amount, the sender's name and the
 * optional note. Returns undefined for every other kind of mail — a payment the
 * account sent, a refund or a newsletter — so a caller never records a payment
 * that did not arrive. The sender's authenticity is a separate check.
 */
export function parsePaypalReceivedMail(mail: { subject: string, text: string }): PaypalReceivedMail | undefined {
  const subject = mail.subject.trim()
  const text = mail.text

  if (REFUND.test(`${subject}\n${text}`)) {
    return undefined
  }
  if (NOT_RECEIVED_SUBJECTS.some(pattern => pattern.test(subject))) {
    return undefined
  }
  if (!RECEIVED_SUBJECTS.some(pattern => pattern.test(subject))) {
    return undefined
  }

  const match = GERMAN_SENTENCE.exec(text) ?? ENGLISH_SENTENCE.exec(text)
  if (!match) {
    return undefined
  }

  const payerName = match[1]!.replace(/^["'“”]+|["'“”]+$/g, '').trim()
  const amountCents = parseMoney(match[2]!)
  if (!payerName || amountCents === undefined) {
    return undefined
  }

  return { amountCents, payerName, note: noteFrom(text) }
}
