import { and, eq } from 'drizzle-orm'
import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { calendarCacheSchema } from '../../../db/cache'
import { calendarCollections } from '../../../db/cache-schema'
import { calendarPreferences } from '../../../db/schema'
import { calendarVisibilitySchema } from '../../../utils/calendar-schema'

// Persists whether a calendar is hidden in the calendar view
export default defineEventHandler(async (event) => {
  const { service, url, hidden } = await readValidatedBody(event, calendarVisibilitySchema)
  const cache = await useCacheDb('calendar', calendarCacheSchema)

  const calendar = await cache.select({ url: calendarCollections.url }).from(calendarCollections)
    .where(and(eq(calendarCollections.service, service), eq(calendarCollections.url, url))).get()
  if (!calendar) {
    throw createError({ status: 404, statusText: 'Calendar not found' })
  }

  await (await useDb()).insert(calendarPreferences).values({ service, calendarUrl: url, hidden })
    .onConflictDoUpdate({
      target: [calendarPreferences.service, calendarPreferences.calendarUrl],
      set: { hidden }
    })

  return { ok: true }
})
