import { isValidIban, normalizeIban } from './iban'

/**
 * The EPC069-12 "BCD" payload a banking app reads from a GiroCode. Version 002,
 * UTF-8, SEPA credit transfer. The BIC line stays in place but empty when the
 * payee has none, as the format requires; the unstructured remittance line is
 * dropped when empty so the payload has no trailing empty lines.
 */

/** 999,999,999.99 EUR in cents */
export const EPC_MAX_AMOUNT_CENTS = 99_999_999_999
export const EPC_NAME_LIMIT = 70
export const EPC_REMITTANCE_LIMIT = 140

export interface EpcQrInput {
  name: string
  iban: string
  bic?: string
  amountCents: number
  remittance: string
}

export function epcQrPayload({ name, iban, bic, amountCents, remittance }: EpcQrInput): string {
  if (!isValidIban(iban)) {
    throw new Error('The IBAN is invalid')
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > EPC_MAX_AMOUNT_CENTS) {
    throw new Error('The amount must be between 0.01 and 999999999.99 EUR')
  }

  const payeeName = name.replace(/[\r\n]+/g, ' ').trim().slice(0, EPC_NAME_LIMIT)
  if (!payeeName) {
    throw new Error('The payee name is required')
  }

  const normalizedBic = bic?.trim().toUpperCase() ?? ''
  if (normalizedBic && !/^[A-Z0-9]{8}(?:[A-Z0-9]{3})?$/.test(normalizedBic)) {
    throw new Error('The BIC is invalid')
  }

  const lines = [
    'BCD',
    '002',
    '1',
    'SCT',
    normalizedBic,
    payeeName,
    normalizeIban(iban),
    `EUR${(amountCents / 100).toFixed(2)}`
  ]

  const purpose = remittance.replace(/[\r\n]+/g, ' ').trim().slice(0, EPC_REMITTANCE_LIMIT)
  if (purpose) {
    // Line 9 is the purpose code and line 10 the structured creditor reference;
    // both stay empty, the reference belongs on line 11 (unstructured remittance).
    lines.push('', '', purpose)
  }

  return lines.join('\n')
}
