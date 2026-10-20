/**
 * Parses an amount as it appears on receipts into integer cents. The last `.`
 * or `,` that is followed by one or two digits at the end is the decimal
 * separator; every other separator groups thousands. So `1.234,56` and
 * `1,234.56` both read as 123456 cents, while `1.234` is 1234 euros because a
 * group of three digits cannot be a cent value. Only positive amounts in EUR.
 */
export function parseMoney(text: string): number | undefined {
  let value = text.replace(/[\s\u00a0\u202f]/g, '')
  value = value.replace(/^(?:EUR|€)/i, '').replace(/(?:EUR|€)$/i, '')

  if (!value) {
    return undefined
  }

  const decimal = /^(.*)[.,](\d{1,2})$/.exec(value)
  let integerText = value
  let cents = 0
  let decimalSeparator: string | undefined

  if (decimal) {
    integerText = decimal[1]!
    cents = Number(decimal[2]!.padEnd(2, '0'))
    decimalSeparator = value.charAt(integerText.length)
  }

  const separators = new Set(integerText.match(/[.,]/g) ?? [])
  // One grouping character at most, and never the one already read as decimal
  if (separators.size > 1 || (decimalSeparator && separators.has(decimalSeparator))) {
    return undefined
  }
  if (!/^\d+$/.test(integerText) && !/^\d{1,3}(?:[.,]\d{3})+$/.test(integerText)) {
    return undefined
  }

  const digits = integerText.replace(/[.,]/g, '')
  const euros = Number(digits)
  if (!digits || !Number.isSafeInteger(euros)) {
    return undefined
  }

  const total = euros * 100 + cents
  return Number.isSafeInteger(total) && total > 0 ? total : undefined
}

/** Integer cents as EUR in the given locale, e.g. `17,99 €` for de-DE. */
export function formatMoney(cents: number, locale = 'de-DE'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100)
}
