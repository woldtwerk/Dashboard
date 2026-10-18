import type { DashboardSeries } from '#layers/core/shared/types/dashboard'

/** Domains with a color of their own; everything else falls back to core. */
const DOMAIN_COLOR_TOKENS = new Set(['mail', 'calendar', 'contacts', 'drive', 'documents', 'core'])

/** CSS color of a domain. Fixed per domain, so a series keeps it in every chart. */
export function domainColor(domain: string): string {
  return `var(--chart-${DOMAIN_COLOR_TOKENS.has(domain) ? domain : 'core'})`
}

/** A nice integer tick step, roughly `raw` wide, from the 1/2/5 ladder. */
function niceIntegerStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / power

  if (normalized <= 1) {
    return power
  }
  if (normalized <= 2) {
    return 2 * power
  }
  if (normalized <= 5) {
    return 5 * power
  }
  return 10 * power
}

/**
 * Explicit integer tick values for a count axis. Up to a maximum of 5 every
 * integer gets its own tick; above that the ticks use a nice integer step.
 */
export function integerTicks(max: number): number[] {
  const top = Number.isFinite(max) ? Math.max(0, Math.ceil(max)) : 0
  if (top <= 5) {
    return Array.from({ length: top + 1 }, (_, index) => index)
  }

  const step = niceIntegerStep(top / 5)
  const ticks: number[] = []
  for (let value = 0; value <= top; value += step) {
    ticks.push(value)
  }
  return ticks
}

export const CHART_RANGES = [7, 30, 90] as const
export type ChartRange = typeof CHART_RANGES[number]

/** The day range from a URL query value, clamped to one of the offered ranges. */
export function rangeFromQuery(value: unknown): ChartRange {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  return (CHART_RANGES as readonly number[]).includes(parsed) ? parsed as ChartRange : 30
}

/**
 * Empty series with no points, so a chart card can show its empty state
 * instead of an axis without data.
 */
export function hasSeriesPoints(series: DashboardSeries | undefined): boolean {
  return !!series?.points?.length
}

export interface BarChartPoint {
  date: string
  value: number
}

/** Rows of a chart shown as a table, keyed for the generic chart card. */
export function seriesTableRows(series: DashboardSeries | undefined): { date: string, value: number }[] {
  return series?.points ?? []
}
