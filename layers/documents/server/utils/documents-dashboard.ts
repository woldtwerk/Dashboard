export interface DocumentsWeekRange {
  /** First day, inclusive, YYYY-MM-DD */
  since: string
  /** Day after the last one, exclusive, YYYY-MM-DD */
  until: string
}

const DAY_MS = 24 * 60 * 60 * 1000

const dateKey = (date: Date) => date.toISOString().slice(0, 10)
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS)

/** UTC midnight of a date */
function dayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** The Monday of the week a date falls in, as UTC midnight */
function weekStart(date: Date): Date {
  const start = dayStart(date)
  const weekday = (start.getUTCDay() + 6) % 7
  return addDays(start, -weekday)
}

/**
 * The last `weeks` calendar weeks, oldest first, each Monday to the next
 * Monday in UTC. The current week is included and may still be partial.
 */
export function weekRanges(today = new Date(), weeks = 12): DocumentsWeekRange[] {
  const count = Math.max(1, Math.floor(weeks))
  const current = weekStart(today)
  const first = addDays(current, -(count - 1) * 7)

  return Array.from({ length: count }, (_, index) => {
    const since = addDays(first, index * 7)
    return { since: dateKey(since), until: dateKey(addDays(since, 7)) }
  })
}
