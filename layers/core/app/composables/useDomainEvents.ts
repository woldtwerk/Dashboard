import { matchesFilter } from '#layers/core/shared/domain-events'
import type { DomainEventFilter } from '#layers/core/shared/domain-events'
import type { DomainEvent } from '#layers/core/shared/types/domain-events'

interface Subscription {
  filter: DomainEventFilter
  handler: (event: DomainEvent) => void
  onReconnect?: () => void
}

// One EventSource per tab, shared by every page; each caller filters in the browser
const subscriptions = new Set<Subscription>()
let source: EventSource | undefined
let watchingVisibility = false

function dispatch(event: DomainEvent) {
  for (const subscription of [...subscriptions]) {
    if (matchesFilter(event, subscription.filter)) {
      subscription.handler(event)
    }
  }
}

function notifyReconnect() {
  for (const subscription of [...subscriptions]) {
    subscription.onReconnect?.()
  }
}

function openSource() {
  if (!import.meta.client) {
    return
  }
  // A closed source is replaced; a connecting/open one is left alone
  if (source && source.readyState !== EventSource.CLOSED) {
    return
  }

  source?.close()
  const current = new EventSource('/api/events')
  source = current
  current.addEventListener('domain-event', (message) => {
    try {
      dispatch(JSON.parse((message as MessageEvent).data) as DomainEvent)
    } catch {
      // Malformed payloads are dropped; the server only sends valid events
    }
  })
  current.addEventListener('error', () => lifecycle.markErrored())
  current.addEventListener('open', () => lifecycle.markOpen())

  if (!watchingVisibility) {
    document.addEventListener('visibilitychange', onVisibilityChange)
    watchingVisibility = true
  }
}

function closeSource() {
  source?.close()
  source = undefined
  if (watchingVisibility) {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    watchingVisibility = false
  }
}

function onVisibilityChange() {
  // Reconnect only when the tab is back and the connection is actually gone
  if (document.visibilityState === 'visible' && (!source || source.readyState === EventSource.CLOSED)) {
    lifecycle.reconnect()
  }
}

const lifecycle = createSourceLifecycle({
  open: openSource,
  close: closeSource,
  onReconnect: notifyReconnect,
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>)
})

/**
 * Runs `handler` for domain events matching `filter`. All callers share one
 * EventSource; it opens with the first subscriber and closes shortly after the
 * last one leaves. `onReconnect` runs when events may have been missed.
 */
export function useDomainEvents(
  filter: DomainEventFilter,
  handler: (event: DomainEvent) => void,
  options?: { onReconnect?: () => void }
) {
  if (!import.meta.client) {
    return
  }

  const subscription: Subscription = { filter, handler, onReconnect: options?.onReconnect }
  subscriptions.add(subscription)
  lifecycle.subscribe()

  onScopeDispose(() => {
    subscriptions.delete(subscription)
    lifecycle.unsubscribe()
  })
}
