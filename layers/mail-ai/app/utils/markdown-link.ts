/** Control characters must never reach an attribute from model output. */
function hasControlCharacters(value: string): boolean {
  return [...value].some(char => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)
}

/**
 * A link the assistant answer may render: an in-app path (`/mail?…`) or an
 * `https:` URL. Everything else — `javascript:`, `data:`, protocol-relative
 * `//evil`, backslash tricks and embedded control characters — is rejected.
 */
export function isSafeAssistantLink(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  const href = value.trim()
  if (!href || hasControlCharacters(href)) {
    return false
  }

  // `//host` is another origin, and browsers read `/\host` the same way
  if (href.startsWith('//') || href.startsWith('/\\')) {
    return false
  }

  if (href.startsWith('/')) {
    return !href.includes('\\')
  }

  if (/^https:\/\//i.test(href)) {
    try {
      return new URL(href).protocol === 'https:'
    } catch {
      return false
    }
  }

  return false
}

/** Whether a link points outside the dashboard, so it opens in a new tab. */
export function isExternalAssistantLink(value: string): boolean {
  return /^https:\/\//i.test(value)
}
