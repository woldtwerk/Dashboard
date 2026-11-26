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
let sessionChecked = false
let signedInUserId: string | undefined
let signOutCache: ReturnType<typeof useQueryCache> | undefined

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

/**
 * A session that expires while the tab stays open makes `/api/events` answer 401,
 * which `EventSource` keeps retrying. Rather than retrying forever, check the
 * session once per error burst and leave for the login page; the auth middleware
 * would otherwise redirect the tab on its next navigation anyway. The full-page
 * navigation keeps this out of any Vue instance.
 */
async function leaveIfSignedOut() {
  if (sessionChecked) {
    return
  }
  sessionChecked = true

  try {
    const session = await $fetch('/api/_auth/session', { headers: { accept: 'application/json' } })
    if (!session?.user) {
      closeSource()
      if (signOutCache) {
        await clearQueryCacheForSignOut(signOutCache, signedInUserId)
      }
      // Reloading the page we are already on would loop, so only leave elsewhere
      if (window.location.pathname !== '/login') {
        window.location.assign('/login')
      }
    }
  } catch {
    // Offline or a network blip: allow the next error to check again
    sessionChecked = false
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
  current.addEventListener('error', () => {
    lifecycle.markErrored()
    void leaveIfSignedOut()
  })
  current.addEventListener('open', () => {
    sessionChecked = false
    lifecycle.markOpen()
  })

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

  const { loggedIn, user } = useUserSession()
  signOutCache ??= useQueryCache()
  const subscription: Subscription = { filter, handler, onReconnect: options?.onReconnect }
  let subscribed = false

  // The stream needs a session: without one `/api/events` answers 401 and the
  // error handler would send `/login` back to itself.
  function sync() {
    if (loggedIn.value === subscribed) {
      return
    }
    subscribed = loggedIn.value

    if (subscribed) {
      signedInUserId = user.value?.id
      subscriptions.add(subscription)
      lifecycle.subscribe()
    } else {
      subscriptions.delete(subscription)
      lifecycle.unsubscribe()
    }
  }

  watch(loggedIn, sync, { immediate: true })

  onScopeDispose(() => {
    if (!subscribed) {
      return
    }
    subscribed = false
    subscriptions.delete(subscription)
    lifecycle.unsubscribe()
  })
}
