import { TZDate } from '@date-fns/tz'
import type { CalendarEvent } from '../../shared/types/calendar'

export interface DashboardEventWindow {
  start: string
  end: string
}

const iso = (date: Date) => new Date(date.getTime()).toISOString()

/**
 * The dashboard windows in the configured calendar zone: today and the next
 * seven days, both starting at local midnight.
 */
export function dashboardWindows(today = new Date(), timeZone = 'UTC'): { today: DashboardEventWindow, week: DashboardEventWindow } {
  const anchor = new TZDate(today.getTime(), timeZone)
  const start = new TZDate(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), timeZone)
  const tomorrow = new TZDate(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1, timeZone)
  const nextWeek = new TZDate(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7, timeZone)

  return {
    today: { start: iso(start), end: iso(tomorrow) },
    week: { start: iso(start), end: iso(nextWeek) }
  }
}

/** Events overlapping the window (start inclusive, end exclusive) */
export function eventsWithin(events: CalendarEvent[], window: DashboardEventWindow): CalendarEvent[] {
  const start = new Date(window.start).getTime()
  const end = new Date(window.end).getTime()

  return events.filter(event => new Date(event.start).getTime() < end && new Date(event.end).getTime() > start)
}
