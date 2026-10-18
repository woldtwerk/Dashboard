import { parseEntityKey } from '../../../core/shared/entities'
import type { SearchHit } from '../../../core/shared/types/search'
import { registerSearchProvider } from '../../../core/server/utils/search'
import type { CalendarSearchHit } from '../utils/calendar-search'

/** `YYYY-MM-DD` of an instant in the calendar's time zone */
function hitDate(hit: CalendarSearchHit, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone
  }).formatToParts(new Date(hit.start))
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? ''

  return `${value('year')}-${value('month')}-${value('day')}`
}

/** A short "date, time" label for the result, read in the calendar's time zone */
function hitSubtitle(hit: CalendarSearchHit, timeZone: string): string {
  const when = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(hit.allDay ? {} : { hour: '2-digit', minute: '2-digit' }),
    timeZone
  }).format(new Date(hit.start))

  return [hit.calendarName, when].filter(Boolean).join(' · ')
}

export default defineNitroPlugin(() => {
  registerSearchProvider({
    domain: 'calendar',
    label: 'Calendar',
    icon: 'i-lucide-calendar',
    async search(q, limit): Promise<SearchHit[]> {
      const services = (await listServices('calendar')).map(item => item.id)
      if (!services.length) {
        return []
      }

      const excludeCalendars = await hiddenCalendarUrls(services)
      const hits = await searchEvents(services, q, { limit, excludeCalendars })
      const timeZone = useRuntimeConfig().public.calendar.timeZone

      return hits.map((hit): SearchHit => {
        const ref = parseEntityKey(hit.ref)
        const [, uid, recurrenceId] = (ref?.id ?? '').split('|')
        const params = new URLSearchParams({ date: hitDate(hit, timeZone) })
        if (uid) {
          params.set('event', uid)
        }
        if (recurrenceId) {
          params.set('recurrence', recurrenceId)
        }

        return {
          ref: hit.ref,
          title: hit.summary,
          titleHighlight: hit.summaryHighlight,
          snippet: hit.snippet,
          subtitle: hitSubtitle(hit, timeZone),
          // The date lets the calendar page load the occurrence's window before
          // opening the event, also when it is far from today
          to: ref ? `/calendar?${params}` : '/calendar',
          date: hit.start
        }
      })
    }
  })
})
