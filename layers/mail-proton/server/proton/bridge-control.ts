import { createError, useRuntimeConfig } from 'nuxt/server'
import type { BridgeAccount } from './bridge-account'
import { toBridgeError } from './bridge-account'

export interface BridgeLogin {
  username: string
  password: string
  totp?: string
  mailboxPassword?: string
}

export function useBridgeControl() {
  const { url, token } = useRuntimeConfig().protonBridge

  if (!url || !token) {
    throw createError({ status: 503, statusText: 'The Proton Bridge container is not configured (NUXT_PROTON_BRIDGE_URL, NUXT_PROTON_BRIDGE_TOKEN)' })
  }

  async function request<T>(path: string, options: { method?: 'GET' | 'POST', body?: object } = {}): Promise<T> {
    try {
      // An external URL, so Nitro's typed routes do not apply
      return await $fetch<T>(path, {
        ...options,
        baseURL: url,
        headers: { authorization: `Bearer ${token}` },
        // Signing in waits for Proton
        timeout: 200_000
      }) as T
    } catch (error) {
      const { response, data } = error as { response?: { status: number }, data?: unknown }
      const { status, message, need } = toBridgeError(response?.status, data)
      throw createError({ status, statusText: message, data: { need }, cause: error })
    }
  }

  return {
    url,
    login: (input: BridgeLogin) => request<BridgeAccount>('/login', { method: 'POST', body: input }),
    getAccount: (account: string) => request<BridgeAccount>(`/accounts/${encodeURIComponent(account)}`)
  }
}
