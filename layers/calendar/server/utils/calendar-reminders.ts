import type { CalendarEvent } from '../../shared/types/calendar'

/** A reminder that fell into the task's look-back window */
export interface DueReminder {
  event: CalendarEvent
  /** Minutes before the start */
  offset: number
}

/** Furthest reminder the event form and the tools allow (four weeks) */
export const MAX_REMINDER_MINUTES = 40_320

/** How far back a scheduled run looks, so a skipped minute is still caught */
export const REMINDER_WINDOW_MS = 2 * 60_000

/**
 * Reminders whose trigger time falls in `[now - windowMs, now]`. Times are
 * absolute instants, so a reminder across a DST change is subtracted in real
 * minutes from the occurrence start. All-day events keep their UTC midnight
 * start, and every offset of an event can be due independently.
 */
export function dueReminders(events: CalendarEvent[], now: Date, windowMs: number = REMINDER_WINDOW_MS): DueReminder[] {
  const from = now.getTime() - windowMs
  const until = now.getTime()

  return events
    .flatMap(event => [...new Set(event.reminders ?? [])]
      .filter((offset) => {
        const at = new Date(event.start).getTime() - offset * 60_000
        return at >= from && at <= until
      })
      .map(offset => ({ event, offset })))
    .sort((a, b) => a.event.start.localeCompare(b.event.start) || a.offset - b.offset)
}

export function reminderBody(offset: number, location?: string): string {
  const when = `in ${offset} min`
  return location ? `${when} · ${location}` : when
}

export function reminderDedupeKey(uid: string, start: string, offset: number): string {
  return `reminder:${uid}:${start}:${offset}`
}

/** Opens the occurrence on the calendar page. */
export function reminderLink(event: CalendarEvent): string {
  const query = new URLSearchParams({ event: event.uid })
  if (event.recurrenceId) {
    query.set('recurrence', event.recurrenceId)
  }

  return `/calendar?${query}`
}
