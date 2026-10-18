import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppNotification } from '../shared/types/notifications'
import { PUSH_BODY_MAX, PUSH_CONCURRENCY, sendPush, toPushPayload } from '../server/utils/web-push'

const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  listSubscriptions: vi.fn(),
  deleteSubscription: vi.fn(),
  warn: vi.fn()
}))

vi.mock('web-push', () => ({
  default: {
    sendNotification: mocks.sendNotification
  }
}))

vi.mock('../server/db/push-subscription-repository', () => ({
  listSubscriptions: mocks.listSubscriptions,
  deleteSubscription: mocks.deleteSubscription,
  upsertSubscription: vi.fn()
}))

vi.mock('../server/utils/service-logger', () => ({
  useServiceLogger: () => ({ warn: mocks.warn, info: vi.fn() })
}))

const notification = (extra: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1',
  category: 'mail-new',
  title: 'Alice',
  body: 'Hello',
  domain: 'mail',
  at: '2026-10-18T10:00:00.000Z',
  read: false,
  ...extra
})

const subscription = (id: string) => ({
  id,
  endpoint: `https://push.example.test/${id}`,
  p256dh: 'p256dh-value',
  auth: 'auth-value',
  userId: null,
  userAgent: null,
  createdAt: new Date('2026-10-18T10:00:00.000Z')
})

beforeEach(() => {
  vi.stubGlobal('useRuntimeConfig', () => ({
    vapid: {
      publicKey: 'public-key',
      privateKey: 'private-key',
      subject: 'mailto:alerts@example.test'
    }
  }))
  vi.stubGlobal('useDb', async () => ({}))

  mocks.sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} })
  mocks.listSubscriptions.mockResolvedValue([])
  mocks.deleteSubscription.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('toPushPayload', () => {
  it('keeps the fields the service worker renders', () => {
    expect(toPushPayload(notification({ to: '/mail/inbox/1' }))).toEqual({
      id: 'n1',
      title: 'Alice',
      body: 'Hello',
      to: '/mail/inbox/1',
      category: 'mail-new'
    })
  })

  it('truncates a long body to 300 characters', () => {
    const body = 'x'.repeat(PUSH_BODY_MAX + 100)

    expect(toPushPayload(notification({ body })).body).toBe('x'.repeat(PUSH_BODY_MAX))
    expect(PUSH_BODY_MAX).toBe(300)
  })

  it('only keeps same-origin paths as a target', () => {
    expect(toPushPayload(notification({ to: '/calendar' })).to).toBe('/calendar')
    expect(toPushPayload(notification({ to: '//evil.test/phish' })).to).toBeUndefined()
    expect(toPushPayload(notification({ to: 'https://evil.test/phish' })).to).toBeUndefined()
    expect(toPushPayload(notification({ to: 'mail/inbox' })).to).toBeUndefined()
  })
})

describe('sendPush', () => {
  it('sends the payload to every subscription', async () => {
    mocks.listSubscriptions.mockResolvedValue([subscription('one'), subscription('two')])

    await sendPush(notification({ to: '/mail/1' }))

    expect(mocks.sendNotification).toHaveBeenCalledTimes(2)
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://push.example.test/one', keys: { p256dh: 'p256dh-value', auth: 'auth-value' } },
      JSON.stringify(toPushPayload(notification({ to: '/mail/1' }))),
      expect.objectContaining({
        TTL: 3600,
        urgency: 'normal',
        vapidDetails: {
          subject: 'mailto:alerts@example.test',
          publicKey: 'public-key',
          privateKey: 'private-key'
        }
      })
    )
  })

  it('deletes a subscription the push service reports as gone', async () => {
    mocks.listSubscriptions.mockResolvedValue([subscription('gone')])
    mocks.sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }))

    await sendPush(notification())

    expect(mocks.deleteSubscription).toHaveBeenCalledWith(expect.anything(), 'https://push.example.test/gone')
    expect(mocks.warn).not.toHaveBeenCalled()
  })

  it('deletes on 404 as well', async () => {
    mocks.listSubscriptions.mockResolvedValue([subscription('missing')])
    mocks.sendNotification.mockRejectedValue(Object.assign(new Error('missing'), { statusCode: 404 }))

    await sendPush(notification())

    expect(mocks.deleteSubscription).toHaveBeenCalledWith(expect.anything(), 'https://push.example.test/missing')
  })

  it('keeps the subscription and logs the endpoint host on other errors', async () => {
    mocks.listSubscriptions.mockResolvedValue([subscription('busy')])
    mocks.sendNotification.mockRejectedValue(Object.assign(new Error('server error'), { statusCode: 500 }))

    await expect(sendPush(notification())).resolves.toBeUndefined()

    expect(mocks.deleteSubscription).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalledOnce()

    const context = mocks.warn.mock.calls[0]?.[1] as Record<string, unknown>
    expect(context.endpoint).toBe('push.example.test')
    expect(JSON.stringify(context)).not.toContain('p256dh-value')
    expect(JSON.stringify(context)).not.toContain('auth-value')
  })

  it('never has more than five pushes in flight', async () => {
    mocks.listSubscriptions.mockResolvedValue(Array.from({ length: 12 }, (_, index) => subscription(String(index))))

    let active = 0
    let peak = 0
    mocks.sendNotification.mockImplementation(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return { statusCode: 201, body: '', headers: {} }
    })

    await sendPush(notification())

    expect(PUSH_CONCURRENCY).toBe(5)
    expect(peak).toBe(5)
    expect(mocks.sendNotification).toHaveBeenCalledTimes(12)
  })

  it('sends nothing while VAPID is not configured', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ vapid: { publicKey: '', privateKey: '', subject: '' } }))
    mocks.listSubscriptions.mockResolvedValue([subscription('one')])

    await sendPush(notification())

    expect(mocks.listSubscriptions).not.toHaveBeenCalled()
    expect(mocks.sendNotification).not.toHaveBeenCalled()
  })
})
