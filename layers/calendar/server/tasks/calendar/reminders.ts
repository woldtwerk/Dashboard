import type { GeneralSettings } from '../../../../core/shared/types/settings'
import {
  dueReminders,
  MAX_REMINDER_MINUTES,
  REMINDER_WINDOW_MS,
  reminderBody,
  reminderDedupeKey,
  reminderLink
} from '../../utils/calendar-reminders'

const LOCK_NAME = 'calendar-reminders'
// A run is short; the lease also tells the other workers to skip this minute
const LOCK_TTL_MS = 55_000

/** The zone floating iCalendar times are read in, from the general settings when set. */
async function reminderTimeZone(): Promise<string> {
  const fallback = useRuntimeConfig().public.calendar.timeZone

  try {
    const general = await getSettings<GeneralSettings>('general')
    return general.timeZone || fallback
  } catch {
    return fallback
  }
}

export default defineTask({
  meta: {
    name: 'calendar:reminders',
    description: 'Send notifications for calendar reminders that are due'
  },
  async run() {
    const sent = await withLock(LOCK_NAME, LOCK_TTL_MS, async () => {
      const now = new Date()
      const timeZone = await reminderTimeZone()
      const logger = useServiceLogger('calendar')
      const services = await listServices('calendar')
      // An occurrence can be due at its start, or up to four weeks before it
      const window = {
        start: new Date(now.getTime() - REMINDER_WINDOW_MS).toISOString(),
        end: new Date(now.getTime() + MAX_REMINDER_MINUTES * 60_000).toISOString()
      }
      let count = 0

      for (const service of services) {
        try {
          const calendars = (await cachedCalendars(service.id)).map(calendar => calendar.url)
          const events = await cachedEvents(service.id, calendars, window, timeZone)

          for (const { event, offset } of dueReminders(events, now)) {
            const notification = await notify({
              category: 'calendar-reminder',
              title: event.title,
              body: reminderBody(offset, event.location),
              to: reminderLink(event),
              domain: 'calendar',
              service: service.id,
              dedupeKey: reminderDedupeKey(event.uid, event.start, offset)
            })

            if (notification) {
              count++
            }
          }
        } catch (error) {
          // One broken cache or notification must not stop the other services
          logger.warn('Could not send calendar reminders', {
            service: service.id,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      return count
    })

    return { result: { sent: sent ?? 0, skipped: sent === undefined } }
  }
})
