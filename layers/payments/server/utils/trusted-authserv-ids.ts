import { useRuntimeConfig } from 'nuxt/server'

/**
 * The authserv-ids whose `Authentication-Results` header may be trusted. Nuxt
 * overrides the default with NUXT_PAYMENTS_TRUSTED_AUTHSERV_IDS (comma-separated);
 * an empty value falls back to the default rather than trusting every server.
 */
export const DEFAULT_TRUSTED_AUTHSERV_IDS = ['mail.protonmail.ch', 'protonmail.ch', 'proton.me'] as const

export function trustedAuthservIds(config?: string | string[] | undefined): string[] {
  const value = config ?? useRuntimeConfig().payments.trustedAuthservIds

  const entries = Array.isArray(value) ? value : String(value ?? '').split(',')
  const ids = entries.map(entry => entry.trim().toLowerCase()).filter(Boolean)
  return ids.length ? ids : [...DEFAULT_TRUSTED_AUTHSERV_IDS]
}
