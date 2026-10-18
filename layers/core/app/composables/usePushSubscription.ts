import { createSharedComposable } from '@vueuse/core'
import type { PushState } from '../utils/web-push'
import { pushSupported, urlBase64ToUint8Array } from '../utils/web-push'

interface PushKeyPayload {
  publicKey: string
}

interface PushSubscriptionBody {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

function subscriptionBody(subscription: PushSubscription): PushSubscriptionBody {
  const { endpoint, keys } = subscription.toJSON()

  if (!endpoint || !keys?.p256dh || !keys.auth) {
    throw new Error('The browser returned an incomplete push subscription')
  }

  return {
    endpoint,
    keys: {
      p256dh: keys.p256dh,
      auth: keys.auth
    }
  }
}

const usePushSubscriptionState = createSharedComposable(() => {
  const toast = useToast()
  const state = ref<PushState>('off')
  const busy = ref(false)

  /** Reads the browser's permission and the subscription it actually holds. */
  async function refresh(): Promise<void> {
    if (!import.meta.client) {
      return
    }

    if (!pushSupported(window)) {
      state.value = 'unsupported'
      return
    }

    if (window.Notification.permission === 'denied') {
      state.value = 'denied'
      return
    }

    if (window.Notification.permission !== 'granted') {
      state.value = 'off'
      return
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      state.value = subscription ? 'on' : 'off'
    } catch {
      state.value = 'off'
    }
  }

  /**
   * Asks for the permission, installs the service worker, subscribes this
   * browser and tells the server. The order matters: the permission request is
   * tied to the user's click.
   */
  async function enable(): Promise<void> {
    if (!import.meta.client || busy.value) {
      return
    }

    if (!pushSupported(window)) {
      state.value = 'unsupported'
      return
    }

    busy.value = true
    try {
      const permission = await window.Notification.requestPermission()
      if (permission !== 'granted') {
        state.value = permission === 'denied' ? 'denied' : 'off'
        return
      }

      const { publicKey } = await $fetch<PushKeyPayload>('/api/push/key')
      const registration = await navigator.serviceWorker.register('/sw.js')
      // subscribe() needs an active worker, not just a registered one
      await navigator.serviceWorker.ready

      const existing = await registration.pushManager.getSubscription()
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      })

      try {
        await $fetch('/api/push/subscriptions', {
          method: 'POST',
          body: subscriptionBody(subscription)
        })
      } catch (error) {
        // A subscription the server does not know never delivers; do not keep it
        if (!existing) {
          await subscription.unsubscribe().catch(() => {})
        }
        throw error
      }

      state.value = 'on'
    } catch {
      state.value = 'off'
      toast.add({ title: 'Could not enable push notifications', color: 'error', icon: 'i-lucide-circle-alert' })
    } finally {
      busy.value = false
    }
  }

  /** Unsubscribes this browser and removes its endpoint from the server. */
  async function disable(): Promise<void> {
    if (!import.meta.client || busy.value) {
      return
    }

    busy.value = true
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()

      if (subscription) {
        const { endpoint } = subscription
        await subscription.unsubscribe()
        state.value = 'off'

        // The local unsubscribe already stops delivery; the server also drops
        // endpoints the push service reports as gone.
        await $fetch('/api/push/subscriptions', { method: 'DELETE', body: { endpoint } }).catch(() => {})
      } else {
        state.value = 'off'
      }
    } catch {
      toast.add({ title: 'Could not disable push notifications', color: 'error', icon: 'i-lucide-circle-alert' })
    } finally {
      busy.value = false
    }
  }

  if (import.meta.client) {
    void refresh()
  }

  return {
    state: readonly(state),
    busy: readonly(busy),
    /** This browser has an active push subscription, so the service worker shows desktop notifications */
    subscribed: computed(() => state.value === 'on'),
    enable,
    disable,
    refresh
  }
})

/** This browser's Web Push subscription: state, enabling and disabling. Client-only. */
export function usePushSubscription() {
  return usePushSubscriptionState()
}
