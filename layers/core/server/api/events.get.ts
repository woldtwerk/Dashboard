import { createEventStream, setResponseHeaders } from 'h3'
import type { H3Event } from 'h3'
import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import { formatSseEvent, matchesFilter, useDomainEventBus } from '../utils/domain-events'

/** A comma separated list of lower-case ids, e.g. `calendar,mail`. */
const list = z.string()
  .transform(value => value.split(',').map(item => item.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^[a-z0-9-]+$/)).max(20))
  .optional()

const eventsQuerySchema = z.object({
  domains: list,
  services: list
})

const PING_INTERVAL_MS = 25_000

export default defineEventHandler(async (event) => {
  const filter = await getValidatedQuery(event, eventsQuerySchema)

  // Nuxt's RequestEvent is a narrower type than h3's H3Event; cast at the h3 boundary
  const h3Event = event as unknown as H3Event

  setResponseHeaders(h3Event, {
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no'
  })

  const stream = createEventStream(h3Event)

  const unsubscribe = useDomainEventBus().subscribe((domainEvent) => {
    if (matchesFilter(domainEvent, filter)) {
      void stream.push(formatSseEvent(domainEvent))
    }
  })

  // h3's event stream only pushes data fields, so the keepalive comment that
  // stops proxies from closing an idle connection goes straight to the socket.
  const timer = setInterval(() => {
    const response = h3Event.node.res
    if (!response.writableEnded) {
      response.write(': ping\n\n')
    }
  }, PING_INTERVAL_MS)

  let closed = false
  stream.onClosed(() => {
    if (closed) {
      return
    }
    closed = true
    clearInterval(timer)
    unsubscribe()
  })

  return stream.send()
})
