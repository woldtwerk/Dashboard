import type { Service } from '../../../core/server/utils/services'
import { safeErrorMessage } from '../../../core/server/utils/errors'
import { openCodeEndpoints, toOpenCodeAccountUsage } from '../../shared/opencode-usage'
import type { OpenCodeAccountUsage } from '../../shared/opencode-usage'

const TIMEOUT_MS = 8000

interface EndpointResult {
  body?: unknown
  error?: string
}

async function readEndpoint(url: string | undefined, apiKey: string): Promise<EndpointResult> {
  if (!url) {
    return {}
  }

  try {
    const response = await fetch(url, {
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'accept': 'application/json',
        'user-agent': 'allmight-dashboard'
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!response.ok) {
      return {
        error: response.status === 401 || response.status === 403
          ? 'The OpenCode API key was rejected'
          : `The OpenCode API answered HTTP ${response.status}`
      }
    }
    return { body: await response.json() }
  } catch (error) {
    return { error: safeErrorMessage(error, 'The OpenCode API could not be reached') }
  }
}

/**
 * Credits and plan usage of an OpenCode service. The `/console/api/*` endpoints
 * are undocumented but are what the OpenCode console itself uses; `/usage` is
 * the documented percentage fallback for Go subscriptions.
 */
export async function openCodeAccountUsage(service: Service): Promise<OpenCodeAccountUsage> {
  const apiKey = service.values.apiKey ? String(service.values.apiKey) : ''
  const baseUrl = service.values.baseUrl ? String(service.values.baseUrl) : ''
  const empty = { serviceId: service.id, serviceName: service.name, meters: [] }

  if (!apiKey) {
    return { ...empty, error: 'The OpenCode service has no API key.' }
  }

  let endpoints
  try {
    endpoints = openCodeEndpoints(baseUrl)
  } catch {
    return { ...empty, error: 'The OpenCode service has no valid base URL.' }
  }

  const [status, billing, usage] = await Promise.all([
    readEndpoint(endpoints.status, apiKey),
    readEndpoint(endpoints.billing, apiKey),
    readEndpoint(endpoints.usage, apiKey)
  ])

  const account = toOpenCodeAccountUsage({
    service: { id: service.id, name: service.name },
    status: status.body,
    billing: billing.body,
    usage: usage.body
  })

  if (!account.meters.length && account.balanceUsd === undefined) {
    account.error = status.error ?? billing.error ?? usage.error ?? 'OpenCode reported no usage or balance.'
  }

  return account
}
