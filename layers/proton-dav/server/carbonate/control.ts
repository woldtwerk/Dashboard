import { createError, useRuntimeConfig } from 'nuxt/server'
import type { CarbonateAccount } from './account'
import { toCarbonateError } from './account'

export interface CarbonateLogin {
  username: string
  password: string
  mailboxPassword?: string
  totp?: string
  verificationToken?: string
}

export interface CarbonateStatus {
  signedIn: boolean
  account?: string | null
  davUrl?: string
  serving?: boolean
}

/**
 * The carbonate container's control API. It signs a Proton account in and
 * returns the DAV credentials; the Proton password is passed through and never
 * stored.
 */
export function useCarbonateControl() {
  const { url, token } = useRuntimeConfig().carbonate

  if (!url || !token) {
    throw createError({ status: 503, statusText: 'The carbonate container is not configured (NUXT_CARBONATE_URL, NUXT_CARBONATE_TOKEN)' })
  }

  async function request<T>(path: string, options: { method?: 'GET' | 'POST', body?: object } = {}): Promise<T> {
    try {
      // An external URL, so Nitro's typed routes do not apply
      return await $fetch<T>(path, {
        ...options,
        baseURL: url,
        headers: { authorization: `Bearer ${token}` },
        // Signing in waits for Proton, and may wait for a human verification
        timeout: 300_000
      }) as T
    } catch (error) {
      const { response, data } = error as { response?: { status: number }, data?: unknown }
      const { status, message, need, verificationUrl } = toCarbonateError(response?.status, data)
      throw createError({ status, statusText: message, data: { need, verificationUrl }, cause: error })
    }
  }

  return {
    url,
    login: (input: CarbonateLogin) => request<CarbonateAccount>('/login', { method: 'POST', body: input }),
    status: () => request<CarbonateStatus>('/status')
  }
}
