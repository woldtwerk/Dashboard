import { z } from 'zod'
import type { LogEntry, LogQuery } from '../../shared/types/logs'

/** A comma separated list of lower-case ids, e.g. `calendar,mail`. */
const idList = z.string()
  .transform(value => value.split(',').map(item => item.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^[a-z0-9-]+$/)).max(50))
  .optional()

const levelList = z.string()
  .transform(value => value.split(',').map(item => item.trim()).filter(Boolean))
  .pipe(z.array(z.enum(['debug', 'info', 'warn', 'error'])).max(4))
  .optional()

export const logQuerySchema = z.object({
  domains: idList,
  services: idList,
  levels: levelList,
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
})

/** The stream has no pagination, only the filters. */
export const logFilterSchema = logQuerySchema.omit({ before: true, limit: true })

export type ParsedLogQuery = z.infer<typeof logQuerySchema>
export type ParsedLogFilter = z.infer<typeof logFilterSchema>

/** Reads a raw `event.query` into the query the store understands. */
export function parseLogQuery(query: unknown): ParsedLogQuery {
  return logQuerySchema.parse(query)
}

/** The subset of a query that selects which entries are shown, without paging. */
export function filterOf(query: LogQuery | ParsedLogQuery): ParsedLogFilter {
  return { domains: query.domains, services: query.services, levels: query.levels }
}

/** Whether a streamed entry passes the subscriber's filter; an empty list matches all. */
export function matchesLogFilter(entry: LogEntry, filter: ParsedLogFilter): boolean {
  if (filter.domains?.length && !filter.domains.includes(entry.domain)) {
    return false
  }
  if (filter.services?.length && !filter.services.includes(entry.service ?? '')) {
    return false
  }
  if (filter.levels?.length && !filter.levels.includes(entry.level)) {
    return false
  }
  return true
}
