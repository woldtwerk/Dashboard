/// <reference lib="webworker" />
// Web Push and offline service worker. It is served at /sw.js, outside the
// authenticated app, because the browser installs and updates it without a
// session.

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import type { PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NAVIGATION_DENYLIST, notificationFromPayload, sameOriginPath } from '../utils/service-worker'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload: unknown
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const { title, options } = notificationFromPayload(payload)

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data as { to?: unknown } | undefined
  const target = sameOriginPath(data?.to)

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

// Navigations stay on the network: server-rendered HTML embeds the user's
// payload and must not be stored on the device. When the network is gone, the
// precached page stands in.
registerRoute(new NavigationRoute(async ({ request }) => {
  try {
    return await fetch(request)
  } catch {
    return await caches.match('/offline.html') ?? new Response('You are offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    })
  }
}, { denylist: NAVIGATION_DENYLIST }))
