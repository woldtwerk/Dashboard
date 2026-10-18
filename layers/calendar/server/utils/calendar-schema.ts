import { createError } from 'nuxt/server'
import { z } from 'zod'

export const calendarsQuerySchema = z.object({
  service: z.string().min(1).optional()
})

export const calendarVisibilitySchema = z.object({
  service: z.string().min(1),
  url: z.string().min(1),
  hidden: z.boolean()
})

export const eventsQuerySchema = z.object({
  service: z.string().min(1).optional(),
  /** Calendar URL; without it every calendar of the service is listed */
  calendar: z.string().min(1).optional(),
  start: z.coerce.date(),
  end: z.coerce.date()
})

export const eventBodySchema = z.object({
  service: z.string().min(1),
  calendar: z.string().min(1),
  title: z.string().trim().min(1).max(500),
  start: z.coerce.date(),
  end: z.coerce.date(),
  allDay: z.boolean().optional(),
  description: z.string().max(20_000).optional(),
  location: z.string().max(1000).optional(),
  /** RRULE value, e.g. `FREQ=WEEKLY;BYDAY=MO` */
  recurrence: z.string().max(1000).optional(),
  /** Reminder offsets in minutes before the start */
  reminders: z.array(z.number().int().min(0).max(40_320)).max(10).optional()
})

/** Which part of a recurring event a write applies to; one occurrence or the series. */
const scopeSchema = z.enum(['one', 'all']).default('all')

export const eventUpdateSchema = eventBodySchema.extend({
  url: z.string().url().optional(),
  etag: z.string().optional(),
  scope: scopeSchema,
  /** Original start of the occurrence the form was opened at */
  recurrenceId: z.coerce.date().optional()
})

export const eventDeleteSchema = z.object({
  service: z.string().min(1),
  calendar: z.string().min(1),
  url: z.string().url().optional(),
  etag: z.string().optional(),
  scope: scopeSchema,
  recurrenceId: z.coerce.date().optional()
})

/** A view never asks for more than this; guards against a runaway REPORT. */
export const CALENDAR_MAX_RANGE_MS = 400 * 24 * 60 * 60 * 1000

/** The requested window, validated and normalized to ISO strings. */
export function toEventWindow(query: { start: Date, end: Date }): { start: string, end: string } {
  const start = query.start
  const end = query.end

  if (end <= start) {
    throw createError({ status: 400, statusText: 'The range end must be after its start' })
  }
  if (end.getTime() - start.getTime() > CALENDAR_MAX_RANGE_MS) {
    throw createError({ status: 400, statusText: 'The requested range is too large' })
  }

  return { start: start.toISOString(), end: end.toISOString() }
}
