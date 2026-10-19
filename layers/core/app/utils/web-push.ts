/** What this browser's push setup is doing, as the settings switch shows it. */
export type PushState = 'unsupported' | 'denied' | 'off' | 'on'

export interface PushStateView {
  /** The switch is on */
  enabled: boolean
  /** The user may change it; `denied` and `unsupported` are fixed by the browser */
  toggleable: boolean
  label: string
}

/**
 * Converts the base64url VAPID key from `runtimeConfig.public.vapidPublicKey`
 * into the byte array `PushManager.subscribe` expects.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replaceAll('-', '+').replaceAll('_', '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)

  for (let index = 0; index < raw.length; index++) {
    bytes[index] = raw.charCodeAt(index)
  }

  return bytes
}

/**
 * The Push API needs a service worker on `navigator`, the PushManager and the
 * Notification API on a secure origin. An insecure origin is reported as
 * unsupported rather than failing halfway through the permission request.
 */
export function pushSupported(env: Window | undefined): boolean {
  return !!env
    && env.isSecureContext
    && 'serviceWorker' in env.navigator
    && 'PushManager' in env
    && 'Notification' in env
}

/** Maps the subscription state to what the settings row shows. */
export function pushStateView(state: PushState): PushStateView {
  switch (state) {
    case 'on':
      return {
        enabled: true,
        toggleable: true,
        label: 'Notifications arrive even when no dashboard tab is open.'
      }
    case 'denied':
      return {
        enabled: false,
        toggleable: false,
        label: 'Blocked in the browser settings'
      }
    case 'unsupported':
      return {
        enabled: false,
        toggleable: false,
        label: 'Not supported'
      }
    default:
      return {
        enabled: false,
        toggleable: true,
        label: 'Turn on to receive notifications while the dashboard is closed.'
      }
  }
}
