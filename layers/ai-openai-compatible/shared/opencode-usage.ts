export type OpenCodeUsageMeterKey = 'rolling' | 'weekly' | 'monthly'

export interface OpenCodeUsageMeter {
  key: OpenCodeUsageMeterKey
  /** 0..100 */
  percent: number
  usedUsd?: number
  limitUsd?: number
  resetsAt?: string
  rateLimited: boolean
}

export interface OpenCodeAccountUsage {
  serviceId: string
  serviceName: string
  /** 'Go' | 'Go Plus' | 'Go Teams' | the raw product value */
  plan?: string
  /** Upper-case currency of the dollar figures, e.g. 'USD' */
  currency?: string
  /** Prepaid Console balance in USD */
  balanceUsd?: number
  meters: OpenCodeUsageMeter[]
  /** Set by the route when nothing could be read */
  error?: string
}

export interface OpenCodeEndpoints {
  status: string
  billing: string
  /** Percentage fallback; only Go bases have one */
  usage?: string
}

const MICRO_CENTS = 100_000_000

const METER_WINDOWS: { key: OpenCodeUsageMeterKey, consoleKey: string, usageKey: string }[] = [
  { key: 'rolling', consoleKey: 'fiveHour', usageKey: 'rolling' },
  { key: 'weekly', consoleKey: 'week', usageKey: 'weekly' },
  { key: 'monthly', consoleKey: 'month', usageKey: 'monthly' }
]

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'string' && !value.trim()) {
    return undefined
  }
  const number = typeof value === 'string' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined
}

/** Origin endpoints of a service base; the URL API rejects an invalid base. */
export function openCodeEndpoints(baseUrl: string): OpenCodeEndpoints {
  const url = new URL(baseUrl)
  return {
    status: `${url.origin}/console/api/go/status`,
    billing: `${url.origin}/console/api/billing/status`,
    ...(url.pathname.startsWith('/inference/go/') ? { usage: `${url.origin}/inference/go/v1/usage` } : {})
  }
}

export function openCodePlanName(product: unknown): string | undefined {
  if (typeof product !== 'string' || !product) {
    return undefined
  }
  const names: Record<string, string> = {
    'go': 'Go',
    'go-plus': 'Go Plus',
    'go-teams': 'Go Teams'
  }
  return names[product] ?? product
}

/** Narrows the raw console and usage bodies; unexpected shapes yield no meters. */
export function toOpenCodeAccountUsage(input: {
  service: { id: string, name: string }
  status?: unknown
  billing?: unknown
  usage?: unknown
}): OpenCodeAccountUsage {
  const status = asRecord(input.status)
  const billing = asRecord(input.billing)
  const usage = asRecord(input.usage)

  const access = asRecord(status?.access)
  const consoleMeters = asRecord(access?.meters)
  const usageWindows = asRecord(usage?.usage)

  const meters = METER_WINDOWS.flatMap(({ key, consoleKey, usageKey }) => {
    const consoleMeter = asRecord(consoleMeters?.[consoleKey])
    const usageMeter = asRecord(usageWindows?.[usageKey])

    const used = asNumber(consoleMeter?.usedMicroCents)
    const limit = asNumber(consoleMeter?.limitMicroCents)
    const percent = limit !== undefined && limit > 0 && used !== undefined
      ? used / limit * 100
      : asNumber(usageMeter?.percent)

    if (percent === undefined) {
      return []
    }

    const consoleReset = typeof consoleMeter?.resetsAt === 'string' ? consoleMeter.resetsAt : undefined
    const usageReset = typeof usageMeter?.resetsAt === 'string' ? usageMeter.resetsAt : undefined
    const resetsAt = consoleReset ?? usageReset

    return [{
      key,
      percent: Math.min(100, Math.max(0, percent)),
      ...(used !== undefined && limit !== undefined
        ? { usedUsd: used / MICRO_CENTS, limitUsd: limit / MICRO_CENTS }
        : {}),
      ...(resetsAt ? { resetsAt } : {}),
      rateLimited: consoleMeter?.status === 'rate-limited' || usageMeter?.status === 'rate-limited'
    }]
  })

  const plan = openCodePlanName(status?.product)
  const currency = typeof status?.renewalCurrency === 'string' && status.renewalCurrency
    ? status.renewalCurrency.toUpperCase()
    : undefined
  const balance = asNumber(billing?.balanceMicroCents)

  return {
    serviceId: input.service.id,
    serviceName: input.service.name,
    ...(plan ? { plan } : {}),
    ...(currency ? { currency } : {}),
    ...(balance !== undefined ? { balanceUsd: balance / MICRO_CENTS } : {}),
    meters
  }
}
