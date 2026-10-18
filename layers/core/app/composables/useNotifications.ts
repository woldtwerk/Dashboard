import { createSharedComposable } from '@vueuse/core'
import type { AppNotification } from '#layers/core/shared/types/notifications'
import type { NotificationSettings } from '#layers/core/shared/types/settings'
import { deliveryFor } from '../utils/notifications'
import type { NotificationPermissionState } from '../utils/notifications'

interface NotificationPayload {
  notifications: AppNotification[]
  unread: number
}

const useNotificationsState = createSharedComposable(() => {
  const toast = useToast()
  const { data, refresh } = useFetch<NotificationPayload>('/api/notifications', {
    key: 'notifications',
    default: () => ({ notifications: [], unread: 0 })
  })
  const { data: settings } = useSettings<NotificationSettings>('notifications')
  const { subscribed: pushSubscribed } = usePushSubscription()

  const permission = ref<NotificationPermissionState>('default')
  const visible = ref(true)
  let source: EventSource | undefined
  let watchingVisibility = false

  function currentPermission(): NotificationPermissionState {
    if (!import.meta.client) {
      return 'unsupported'
    }
    if (!('Notification' in window)) {
      return 'unsupported'
    }
    return window.Notification.permission
  }

  function showDesktop(notification: AppNotification) {
    // Web Push already delivers this one through the service worker. Showing a
    // window.Notification here as well would announce the same event twice.
    if (pushSubscribed.value) {
      return
    }

    const desktop = new window.Notification(notification.title, {
      body: notification.body,
      // The tag makes several open tabs collapse into one OS notification
      tag: notification.id,
      data: { to: notification.to }
    })

    desktop.onclick = () => {
      window.focus()
      if (notification.to) {
        void navigateTo(notification.to)
      }
      desktop.close()
    }
  }

  function receive(notification: AppNotification) {
    const current = data.value
    if (!current || current.notifications.some(item => item.id === notification.id)) {
      return
    }

    data.value = {
      notifications: [notification, ...current.notifications].slice(0, 50),
      unread: current.unread + (notification.read ? 0 : 1)
    }

    const delivery = deliveryFor(notification, settings.value, permission.value, visible.value)

    if (delivery.toast) {
      toast.add({
        title: notification.title,
        description: notification.body,
        icon: 'i-lucide-bell',
        actions: notification.to
          ? [{ label: 'Open', onClick: () => { void navigateTo(notification.to!) } }]
          : undefined
      })
    }

    if (delivery.desktop) {
      showDesktop(notification)
    }
  }

  function openSource() {
    if (!import.meta.client) {
      return
    }
    if (source && source.readyState !== EventSource.CLOSED) {
      return
    }

    source?.close()
    const current = new EventSource('/api/notifications/stream')
    source = current
    current.addEventListener('notification', (message) => {
      try {
        receive(JSON.parse((message as MessageEvent).data) as AppNotification)
      } catch {
        // Malformed payloads are dropped; the server only sends valid notifications
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
    visible.value = document.visibilityState === 'visible'
    if (visible.value && (!source || source.readyState === EventSource.CLOSED)) {
      lifecycle.reconnect()
    }
  }

  const lifecycle = createSourceLifecycle({
    open: openSource,
    close: closeSource,
    onReconnect: () => void refresh(),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>)
  })

  async function requestPermission(): Promise<void> {
    if (!import.meta.client) {
      return
    }
    if (!('Notification' in window)) {
      permission.value = 'unsupported'
      return
    }

    permission.value = await window.Notification.requestPermission()
  }

  /** Marks the given notifications read, or all of them when no ids are given. */
  async function markRead(ids?: string[]): Promise<void> {
    const snapshot = data.value
    const selected = new Set(ids ?? [])
    const marksAll = !ids?.length
    const isMarked = (notification: AppNotification) => marksAll || selected.has(notification.id)

    data.value = {
      notifications: snapshot.notifications.map(notification => isMarked(notification) ? { ...notification, read: true } : notification),
      unread: snapshot.notifications.filter(notification => !notification.read && !isMarked(notification)).length
    }

    try {
      const result = await $fetch<{ unread: number }>('/api/notifications/read', {
        method: 'POST',
        body: ids?.length ? { ids } : {}
      })
      data.value = { ...data.value, unread: result.unread }
    } catch {
      data.value = snapshot
      toast.add({ title: 'Could not mark the notifications read', color: 'error', icon: 'i-lucide-circle-alert' })
    }
  }

  if (import.meta.client) {
    visible.value = document.visibilityState === 'visible'
    permission.value = currentPermission()
    lifecycle.subscribe()

    onScopeDispose(() => {
      lifecycle.unsubscribe()
    })
  }

  return {
    notifications: computed(() => data.value?.notifications ?? []),
    unread: computed(() => data.value?.unread ?? 0),
    permission,
    requestPermission,
    markRead,
    refresh
  }
})

/**
 * The tab's notifications: the list, the unread count and one shared stream.
 * Delivery follows the user's per-category style and the do-not-disturb switch.
 */
export function useNotifications() {
  return useNotificationsState()
}
