import { describe, expect, it } from 'vitest'
import type { AppNotification } from '../shared/types/notifications'
import type { DomainEvent } from '../shared/types/domain-events'
import type { NotificationSettings } from '../shared/types/settings'
import { deliveryFor, desktopPermissionView } from '../app/utils/notifications'
import { syncFailedNotification } from '../server/utils/notification-events'
import { notificationSettingsDefaults, registerNotificationCategory } from '../server/utils/notifications'

const notification = (category = 'mail-new'): AppNotification => ({
  id: 'n1',
  category,
  title: 'Alice',
  body: 'Hello',
  domain: 'mail',
  at: '2026-10-18T10:00:00.000Z',
  read: false
})

const settings = (categories: NotificationSettings['categories'], doNotDisturb = false): NotificationSettings => ({
  doNotDisturb,
  categories
})

describe('deliveryFor', () => {
  it('keeps in-app notifications as a toast', () => {
    expect(deliveryFor(notification(), settings({ 'mail-new': 'in-app' }), 'granted', true)).toEqual({ toast: true, desktop: false })
  })

  it('only shows a desktop notification when the permission is granted', () => {
    expect(deliveryFor(notification(), settings({ 'mail-new': 'desktop' }), 'granted', true)).toEqual({ toast: false, desktop: true })
    expect(deliveryFor(notification(), settings({ 'mail-new': 'desktop' }), 'denied', true)).toEqual({ toast: false, desktop: false })
  })

  it('shows a desktop notification even while the tab is visible', () => {
    expect(deliveryFor(notification(), settings({ 'mail-new': 'both' }), 'granted', true)).toEqual({ toast: true, desktop: true })
  })

  it('does not duplicate a hidden tab with a toast when the style is both', () => {
    expect(deliveryFor(notification(), settings({ 'mail-new': 'both' }), 'granted', false)).toEqual({ toast: false, desktop: true })
  })

  it('suppresses toasts and desktop notifications in do-not-disturb mode', () => {
    expect(deliveryFor(notification(), settings({ 'mail-new': 'both' }, true), 'granted', true)).toEqual({ toast: false, desktop: false })
  })

  it('sends nothing for a category switched off', () => {
    expect(deliveryFor(notification(), settings({ 'mail-new': 'off' }), 'granted', true)).toEqual({ toast: false, desktop: false })
  })

  it('falls back to in-app for an unknown category', () => {
    expect(deliveryFor(notification('unknown'), settings({}), 'granted', true)).toEqual({ toast: true, desktop: false })
  })
})

describe('desktopPermissionView', () => {
  it('offers the request button only while the permission is undecided', () => {
    expect(desktopPermissionView('default')).toEqual({
      status: 'default',
      label: 'Not requested yet',
      showButton: true,
      showBadge: false
    })
  })

  it('shows a success badge without a button once granted', () => {
    expect(desktopPermissionView('granted')).toEqual({
      status: 'granted',
      label: 'Allowed',
      showButton: false,
      showBadge: true
    })
  })

  it('explains the site settings when denied, with no button', () => {
    const view = desktopPermissionView('denied')

    expect(view.status).toBe('denied')
    expect(view.showButton).toBe(false)
    expect(view.showBadge).toBe(false)
    expect(view.hint).toContain('will not ask again')
    expect(view.hint).toContain('site settings')
  })

  it('says so when the Notification API is unavailable', () => {
    const view = desktopPermissionView('unsupported')

    expect(view.status).toBe('unsupported')
    expect(view.showButton).toBe(false)
    expect(view.showBadge).toBe(false)
    expect(view.label).toContain('Not supported')
    expect(view.hint).toContain('Notification API')
  })
})

describe('notificationSettingsDefaults', () => {
  it('uses every registered category and its default style', () => {
    registerNotificationCategory({ id: 'mail-new', domain: 'mail', label: 'New mail', defaultStyle: 'both' })
    registerNotificationCategory({ id: 'calendar-reminder', domain: 'calendar', label: 'Reminders', defaultStyle: 'in-app' })

    const defaults = notificationSettingsDefaults()

    expect(defaults.doNotDisturb).toBe(false)
    expect(defaults.categories['mail-new']).toBe('both')
    expect(defaults.categories['calendar-reminder']).toBe('in-app')
  })
})

describe('syncFailedNotification', () => {
  const event: DomainEvent = {
    domain: 'mail',
    service: 'service-1',
    type: 'sync-failed',
    at: '2026-10-18T10:00:00.000Z'
  }

  it('names the service and the hour bucket', () => {
    const now = new Date('2026-10-18T10:30:00.000Z')

    expect(syncFailedNotification(event, 'Proton Mail', now)).toEqual({
      category: 'sync-failed',
      title: 'Proton Mail: sync failed',
      domain: 'mail',
      service: 'service-1',
      dedupeKey: `sync-failed:service-1:${Math.floor(now.getTime() / 3_600_000)}`
    })
  })

  it('reuses the same bucket within one hour', () => {
    const first = syncFailedNotification(event, 'Proton Mail', new Date('2026-10-18T10:00:00.000Z'))
    const second = syncFailedNotification(event, 'Proton Mail', new Date('2026-10-18T10:59:00.000Z'))

    expect(first.dedupeKey).toBe(second.dedupeKey)
  })
})
