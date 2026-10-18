import type { DashboardMetric, ServiceHealth } from '#layers/core/shared/types/dashboard'
import { formatRelative } from './time'

const COUNT_FORMAT = new Intl.NumberFormat('en')
const BYTE_UNITS = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB']

/** Grouped integer, e.g. `1234` → `1,234`. */
export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value)
}

/** Binary size, e.g. `1536` → `1.5 KiB`, `1048576` → `1 MiB`. */
export function formatBytes(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs < 1024) {
    return `${sign}${Math.round(abs)} B`
  }

  let size = abs
  let unit = -1
  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024
    unit++
  }
  return `${sign}${Math.round(size * 10) / 10} ${BYTE_UNITS[unit]}`
}

/** Headline number of a stat tile; a missing value renders as an em dash. */
export function formatMetric(metric: Pick<DashboardMetric, 'value' | 'unit'>): string {
  if (metric.value === null || metric.value === undefined) {
    return '—'
  }
  return metric.unit === 'bytes' ? formatBytes(metric.value) : formatCount(metric.value)
}

export interface ServiceHealthMeta {
  label: string
  icon: string
  /** CSS color from the status tokens or a neutral Nuxt UI token. */
  color: string
  spinning: boolean
}

/** Icon, label and color of a service's health, never color alone. */
export function serviceHealthMeta(health: ServiceHealth): ServiceHealthMeta {
  switch (health) {
    case 'ok':
      return { label: 'Synced', icon: 'i-lucide-circle-check', color: 'var(--status-good)', spinning: false }
    case 'syncing':
      return { label: 'Syncing', icon: 'i-lucide-refresh-cw', color: 'var(--ui-text-muted)', spinning: true }
    case 'error':
      return { label: 'Error', icon: 'i-lucide-triangle-alert', color: 'var(--status-critical)', spinning: false }
    default:
      return { label: 'Unknown', icon: 'i-lucide-minus', color: 'var(--ui-text-dimmed)', spinning: false }
  }
}

/** Health label including when the last sync finished, e.g. `Synced 2 min ago`. */
export function serviceStatusLabel(health: ServiceHealth, syncedAt: string | null, now: Date): string {
  const { label } = serviceHealthMeta(health)
  return health === 'ok' && syncedAt ? `${label} ${formatRelative(syncedAt, now)}` : label
}
