import { createError, useRuntimeConfig } from 'nuxt/server'
import type { SetupValues } from '../../../core/shared/types/setup'

export interface LumoTamerLogin {
  email: string
  password: string
  totp?: string
}

/** A Proton account signed in to the Lumo proxy container, as its control API returns it */
export interface LumoTamerSession {
  signedIn: boolean
  email?: string
  /** OpenAI-compatible endpoint of the proxy, which is what the service stores */
  baseUrl: string
  /** Key the proxy requires; handed out on sign-in so nobody types it by hand */
  apiKey: string
}

/** Message for the input the control API reports as missing */
const needMessages: Record<string, string> = {
  totp: 'Enter the two-factor code of your Proton account',
  captcha: 'Proton asked for a CAPTCHA. Try again.'
}

/** Service values for a signed-in account */
export function toLumoValues({ baseUrl, apiKey, email }: LumoTamerSession): SetupValues {
  return { baseUrl, apiKey, email }
}

/** Message and missing input from an error of the control API */
export function toLumoControlError(status: number | undefined, data: unknown): { status: number, message: string, need?: string } {
  const { error, need } = (data ?? {}) as { error?: string, need?: string | null }

  // No response at all: the container is down or the URL is wrong
  if (!status) {
    return { status: 503, message: 'The Lumo proxy container is not reachable. Is it running?' }
  }

  // The container answered, but not with our token
  if (status === 401 || status === 403) {
    return { status: 503, message: 'The Lumo proxy container rejected the dashboard token. Does NUXT_LUMO_TAMER_TOKEN match its TAMER_CONTROL_TOKEN?' }
  }

  // The container itself failed, e.g. while restarting the proxy after a sign-in
  if (status >= 500) {
    return { status: 502, message: error || 'The Lumo proxy container could not handle the request. Check its logs.', need: need ?? undefined }
  }

  return { status, message: error || needMessages[need ?? ''] || 'The Lumo proxy could not handle the request', need: need ?? undefined }
}

/** The Lumo proxy container's control API: it signs a Proton account in for tamer */
export function useLumoControl() {
  const { url, token } = useRuntimeConfig().lumoTamer

  if (!url || !token) {
    throw createError({ status: 503, statusText: 'The Lumo proxy container is not configured (NUXT_LUMO_TAMER_URL, NUXT_LUMO_TAMER_TOKEN)' })
  }

  async function request<T>(path: string, options: { method?: 'GET' | 'POST', body?: object } = {}): Promise<T> {
    try {
      // An external URL, so Nitro's typed routes do not apply
      return await $fetch<T>(path, {
        ...options,
        baseURL: url,
        headers: { authorization: `Bearer ${token}` },
        // SRP and 2FA are slow, and the container restarts the proxy after the login
        timeout: 200_000
      }) as T
    } catch (error) {
      const { response, data } = error as { response?: { status: number }, data?: unknown }
      const { status, message, need } = toLumoControlError(response?.status, data)
      throw createError({ status, statusText: message, data: { need }, cause: error })
    }
  }

  return {
    url,
    login: (input: LumoTamerLogin) => request<LumoTamerSession>('/login', { method: 'POST', body: input }),
    status: () => request<LumoTamerSession>('/status'),
    logout: async () => {
      await request<unknown>('/logout', { method: 'POST' })
    }
  }
}
