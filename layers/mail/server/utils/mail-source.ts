import { simpleParser } from 'mailparser'

/**
 * The HTML body of a raw message. The action that reads a PayPal mail by its
 * markup verifies the signature on the raw source anyway, so the same fetch
 * carries the body too — no second connection for the same mail.
 */
export async function htmlBodyFromRaw(raw: Buffer | string): Promise<string | undefined> {
  const parsed = await simpleParser(raw)
  return typeof parsed.html === 'string' && parsed.html.trim() ? parsed.html : undefined
}
