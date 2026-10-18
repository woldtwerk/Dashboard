import { eq } from 'drizzle-orm'
import type { DashboardMetric, ServiceStatus } from '../../../core/shared/types/dashboard'
import type { ServiceInfo } from '../../../core/shared/types/setup'
import type { CalendarEvent } from '../../shared/types/calendar'
import { calendarPreferences } from '../db/schema'
import { dashboardWindows, eventsWithin } from '../utils/calendar-dashboard'
import type { DashboardEventWindow } from '../utils/calendar-dashboard'

async function status(service: ServiceInfo): Promise<Omit<ServiceStatus, 'id' | 'name' | 'domain' | 'icon'>> {
  const state = await getCalendarSyncStatus(service.id)

  if (state.syncing) {
    return { health: 'syncing', syncedAt: state.syncedAt }
  }
  if (state.error) {
    return { health: 'error', syncedAt: state.syncedAt, error: state.error }
  }
  return { health: state.syncedAt ? 'ok' : 'unknown', syncedAt: state.syncedAt }
}

/** Visible calendars of a service, read from the cache without starting a sync */
async function visibleCalendars(service: string): Promise<string[]> {
  const [calendars, preferences] = await Promise.all([
    cachedCalendars(service),
    (await useDb()).select().from(calendarPreferences).where(eq(calendarPreferences.service, service))
  ])
  const hidden = new Set(preferences.filter(row => row.hidden).map(row => row.calendarUrl))

  return calendars.map(calendar => calendar.url).filter(url => !hidden.has(url))
}

async function serviceEvents(service: string, window: DashboardEventWindow, timeZone: string): Promise<CalendarEvent[]> {
  const calendars = await visibleCalendars(service)
  return cachedEvents(service, calendars, window, timeZone)
}

async function counts(): Promise<{ today: number | null, week: number | null }> {
  const services = await listServices('calendar')
  if (!services.length) {
    return { today: null, week: null }
  }

  const timeZone = useRuntimeConfig().public.calendar.timeZone
  const windows = dashboardWindows(new Date(), timeZone)
  let available = 0

  const events = (await Promise.all(services.map(async (service) => {
    try {
      const result = await serviceEvents(service.id, windows.week, timeZone)
      available++
      return result
    } catch {
      // One unreachable service must not hide the others
      return []
    }
  }))).flat()

  if (!available) {
    return { today: null, week: null }
  }

  return { today: eventsWithin(events, windows.today).length, week: events.length }
}

export default defineNitroPlugin(() => {
  registerDashboardSource('calendar', {
    status,
    async metrics(): Promise<DashboardMetric[]> {
      const { today, week } = await counts()

      return [{
        id: 'events-today',
        domain: 'calendar',
        label: 'Events today',
        value: today,
        unit: 'count',
        icon: 'i-lucide-calendar-days',
        to: '/calendar'
      }, {
        id: 'events-week',
        domain: 'calendar',
        label: 'Events this week',
        value: week,
        unit: 'count',
        icon: 'i-lucide-calendar-range',
        to: '/calendar?view=week'
      }]
    }
  })
})
