import { createEventStream, setResponseHeaders } from 'h3'
import type { H3Event } from 'h3'
import { defineEventHandler } from 'nuxt/server'
import { formatSseNotification, parseNotificationValue } from '../../utils/notifications'
import { useDomainEventBus } from '../../utils/domain-events'

const PING_INTERVAL_MS = 25_000

export default defineEventHandler(async (event) => {
  // Nuxt's RequestEvent is a narrower type than h3's H3Event; cast at the h3 boundary
  const h3Event = event as unknown as H3Event

  setResponseHeaders(h3Event, {
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no'
  })

  const stream = createEventStream(h3Event)

  const unsubscribe = useDomainEventBus().subscribeTo('notifications', (payload) => {
    const notification = parseNotificationValue(payload)
    if (notification) {
      void stream.push(formatSseNotification(notification))
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
