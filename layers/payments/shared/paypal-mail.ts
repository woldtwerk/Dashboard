import { parseMoney } from './money'

export interface PaypalReceivedMail {
  amountCents: number
  payerName: string
  /** The free text the payer wrote, at most 500 characters */
  note?: string
  /** PayPal's own id for the payment, `^[0-9A-Z]{17}$` */
  transactionId?: string
}

/** What PayPal puts in the subject of money the account sent, not received */
const SENT_SUBJECTS = [
  /\bYou (?:sent|have sent|'ve sent)\b/i,
  /\bSie haben\b[^\n]{0,120}?\bgesendet\b/i
]

/** A refund is money leaving the account, never a payment to confirm */
const REFUND = /\brefund(?:ed)?\b|\bRückzahlung\b|\bzurückgezahlt\b/i

/** An amount as PayPal writes it in a headline: `7,00 € EUR`, `€2.83 EUR`, `1.234,56 €` */
const MONEY = String.raw`(?:€\s*)?\d[\d.,]*(?:\s*€)?(?:\s*EUR)?`

/**
 * The payment sentence that heads the mail, anchored on the whole line: the
 * name ends where `has sent you`/`hat Ihnen` begins, so the verb can never end
 * up inside the name.
 */
const ENGLISH_HEADLINE = new RegExp(String.raw`^(.+?) (?:has )?sent you (${MONEY})\.?$`, 'i')
const GERMAN_HEADLINE = new RegExp(String.raw`^(.+?) hat Ihnen (?:eine Zahlung (?:über|von) )?(${MONEY}) gesendet\.?$`, 'i')

/** The label of the row that carries the amount PayPal actually received */
const AMOUNT_LABEL = /^(?:Amount received|Erhaltener Betrag)\s*:?$/i

/** The label of the row that carries the payer's note, with the payer's name after it */
const NOTE_LABEL = /^(?:Note|Mitteilung|Nachricht)(?:\s+(?:from|von)\s+.{1,120})?\s*:?$/i

/** The label of the row that carries PayPal's id for the payment */
const TRANSACTION_LABEL = /^(?:Transaction ID|Transaktionscode)\s*:?$/i

const TRANSACTION_ID = /^[0-9A-Z]{17}$/
const TRANSACTION_LINK = /\/myaccount\/activities\/details\/([0-9A-Z]{17})(?:[?"#]|$)/

const NOTE_LIMIT = 500

/** The euro sign and the code PayPal appends, e.g. `7,00 €` or `7,00 € EUR` */
const CURRENCY_SUFFIX = /(?:\s*(?:EUR|€))+$/i

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', euro: '€' }

/**
 * An amount as the mail states it, without the `EUR` code PayPal writes after
 * the euro sign (`parseMoney` reads one currency marker, not two).
 */
function parseAmount(text: string): number | undefined {
  return parseMoney(text.trim().replace(CURRENCY_SUFFIX, '').trim())
}

/** Resolves the entities PayPal's HTML uses, named and numeric. */
function decodeEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z][a-z0-9]*));/gi, (raw, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
    if (hex || decimal) {
      const code = Number.parseInt(hex ?? decimal!, hex ? 16 : 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw
    }
    return NAMED_ENTITIES[name!.toLowerCase()] ?? raw
  })
}

/** The tags that end a line of text in PayPal's table layout */
const LINE_BREAK = /<\/(?:p|div|h[1-6]|li|table|tbody|tr|td|th)>|<br\s*\/?>/gi

/** Tidy, non-empty lines of a body, so a line is one cell or one sentence */
function tidyLines(lines: string[]): string[] {
  return lines.map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/** The lines of an HTML mail: each table cell, paragraph and `<br>` on its own line */
function linesFromHtml(html: string): string[] {
  const markup = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '\n')
    .replace(LINE_BREAK, '\n')
    .replace(/<[^>]*>/g, '')

  return tidyLines(decodeEntities(markup).split('\n'))
}

function linesFromText(text: string): string[] {
  return tidyLines(text.replace(/\r\n?/g, '\n').split('\n'))
}

/** The value of a label row: the line below the label, as PayPal's cells lay it out */
function valueAfter(lines: string[], label: RegExp): string | undefined {
  const index = lines.findIndex(line => label.test(line))
  return index === -1 ? undefined : lines[index + 1]
}

/** The payer and amount the payment sentence of a line names, if it is one */
function headlineIn(line: string): { payerName: string, amountCents: number } | undefined {
  const match = ENGLISH_HEADLINE.exec(line) ?? GERMAN_HEADLINE.exec(line)
  if (!match) {
    return undefined
  }

  const payerName = match[1]!.replace(/^["'“”]+|["'“”]+$/g, '').trim()
  const amountCents = parseAmount(match[2]!)
  return payerName && amountCents !== undefined ? { payerName, amountCents } : undefined
}

function headlineOf(lines: string[]): { payerName: string, amountCents: number } | undefined {
  for (const line of lines) {
    const headline = headlineIn(line)
    if (headline) {
      return headline
    }
  }
  return undefined
}

/** PayPal's id for the payment, from its own cell or from a details link */
function transactionIdOf(lines: string[], html: string | undefined): string | undefined {
  const cell = valueAfter(lines, TRANSACTION_LABEL)?.trim()
  if (cell && TRANSACTION_ID.test(cell)) {
    return cell
  }

  const fromLink = TRANSACTION_LINK.exec(html ?? '')?.[1]
  return fromLink && TRANSACTION_ID.test(fromLink) ? fromLink : undefined
}

/** The note cell, trimmed and capped; a missing or blank cell has no note */
function noteOf(lines: string[]): string | undefined {
  return valueAfter(lines, NOTE_LABEL)?.trim().slice(0, NOTE_LIMIT) || undefined
}

/**
 * Reads a PayPal "money received" mail: its amount, the sender's name, the note
 * the payer wrote and PayPal's transaction id. The HTML body is read when there
 * is one — PayPal's mails are often HTML only — and the text body otherwise.
 *
 * Returns undefined for every other kind of mail — a payment the account sent, a
 * refund or a newsletter — and for a mail that states two different amounts, so
 * a caller never records a payment that did not arrive. The sender's
 * authenticity is a separate check (`verifySenderDkim`).
 */
export function parsePaypalReceivedMail(mail: { subject: string, text?: string, html?: string }): PaypalReceivedMail | undefined {
  const subject = mail.subject.trim()
  const lines = mail.html?.trim() ? linesFromHtml(mail.html) : linesFromText(mail.text ?? '')
  const body = lines.join('\n')

  if (REFUND.test(`${subject}\n${body}`) || SENT_SUBJECTS.some(pattern => pattern.test(subject))) {
    return undefined
  }

  // The payment sentence is the evidence: a subject we know says nothing about
  // the payer and the amount, an unknown or localised one may be anywhere, and a
  // mail about money the account sent never carries this sentence.
  const headline = headlineOf(lines)
  if (!headline) {
    return undefined
  }

  const stated = valueAfter(lines, AMOUNT_LABEL)
  const statedCents = stated === undefined ? undefined : parseAmount(stated)
  if (statedCents !== undefined && statedCents !== headline.amountCents) {
    return undefined
  }

  const note = noteOf(lines)
  const transactionId = transactionIdOf(lines, mail.html)

  return {
    amountCents: statedCents ?? headline.amountCents,
    payerName: headline.payerName,
    ...(note ? { note } : {}),
    ...(transactionId ? { transactionId } : {})
  }
}
