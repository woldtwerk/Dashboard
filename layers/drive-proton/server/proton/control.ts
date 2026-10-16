import { createError, useRuntimeConfig } from 'nuxt/server'
import type { DriveCommandResult } from './drive-command'

export interface ProtonDriveLoginStatus {
  pending: boolean
  signedIn: boolean
  error?: string | null
}

/**
 * The proton-drive container's control API. It signs a Proton account in (the
 * CLI prints a browser URL and waits) and runs whitelisted CLI commands for the
 * explorer.
 */
export function useProtonDriveControl() {
  const { url, token } = useRuntimeConfig().protonDrive

  if (!url || !token) {
    throw createError({ status: 503, statusText: 'The Proton Drive container is not configured (NUXT_PROTON_DRIVE_URL, NUXT_PROTON_DRIVE_TOKEN)' })
  }

  const headers = { authorization: `Bearer ${token}` }

  async function request<T>(path: string, options: { method?: 'GET' | 'POST', body?: object } = {}): Promise<T> {
    try {
      // An external URL, so Nitro's typed routes do not apply
      return await $fetch<T>(path, {
        ...options,
        baseURL: url,
        headers,
        // Listing and moving can be slow on a large account
        timeout: 300_000
      }) as T
    } catch (error) {
      const { response, data } = error as { response?: { status: number }, data?: unknown }
      const message = (data as { error?: string } | undefined)?.error

      if (!response?.status) {
        throw createError({ status: 503, statusText: 'The Proton Drive container is not reachable. Is it running?' })
      }
      throw createError({ status: response.status, statusText: message || 'Proton Drive could not handle the request', cause: error })
    }
  }

  return {
    url,
    token,
    headers,
    login: () => request<{ signInUrl: string }>('/login', { method: 'POST' }),
    loginStatus: () => request<ProtonDriveLoginStatus>('/login/status'),
    status: () => request<{ signedIn: boolean, account?: string | null }>('/status'),
    command: (argv: string[]) => request<DriveCommandResult>('/command', { method: 'POST', body: { argv } })
  }
}
