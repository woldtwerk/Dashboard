// Web Push service worker. It is served at /sw.js, outside the authenticated
// app, because the browser installs and updates it without a session.

/** Only paths on this origin may be opened; `//host` would leave the dashboard. */
function sameOriginPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return undefined
  }
  return value
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const target = sameOriginPath(payload.to)

  event.waitUntil(self.registration.showNotification(payload.title || 'Allmight', {
    body: payload.body || undefined,
    tag: payload.id || undefined,
    data: { to: target },
    icon: '/favicon.ico'
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const target = sameOriginPath(event.notification.data && event.notification.data.to)

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) {
        continue
      }

      const focused = await client.focus()

      if (!target) {
        return
      }

      try {
        if (typeof focused.navigate === 'function') {
          await focused.navigate(target)
        } else {
          focused.postMessage({ type: 'notification-click', to: target })
        }
      } catch {
        focused.postMessage({ type: 'notification-click', to: target })
      }
      return
    }

    await self.clients.openWindow(target || '/')
  })())
})
