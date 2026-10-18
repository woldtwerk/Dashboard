import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, openSqlite } from '../server/db/client'
import type { Database } from '../server/db/client'
import { loadMigrations, runMigrations } from '../server/db/migrate'
import { notify, registerNotificationCategory } from '../server/utils/notifications'

const mocks = vi.hoisted(() => ({
  sendPush: vi.fn(),
  getSettings: vi.fn(),
  publishToChannel: vi.fn()
}))

vi.mock('../server/utils/web-push', () => ({
  sendPush: mocks.sendPush
}))

vi.mock('../server/utils/settings', () => ({
  getSettings: mocks.getSettings
}))

vi.mock('../server/utils/domain-events', () => ({
  publishToChannel: mocks.publishToChannel
}))

const migrationsDir = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

const settings = (style: string, doNotDisturb = false) => ({
  doNotDisturb,
  categories: { 'mail-new': style }
})

let db: Database

beforeEach(async () => {
  const sqlite = openSqlite(':memory:')
  runMigrations(sqlite, await loadMigrations(readMigration))
  db = createDatabase(sqlite)

  vi.stubGlobal('useDb', async () => db)
  mocks.sendPush.mockResolvedValue(undefined)
  mocks.publishToChannel.mockResolvedValue(undefined)
  registerNotificationCategory({
    id: 'mail-new',
    domain: 'mail',
    label: 'New mail',
    defaultStyle: 'in-app'
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('notify and Web Push', () => {
  it.each(['desktop', 'both'])('sends a push for a %s category', async (style) => {
    mocks.getSettings.mockResolvedValue(settings(style))

    const notification = await notify({
      category: 'mail-new',
      title: 'Alice',
      body: 'Hello',
      to: '/mail/1',
      domain: 'mail'
    })

    expect(notification).toBeDefined()
    expect(mocks.sendPush).toHaveBeenCalledOnce()
    expect(mocks.sendPush).toHaveBeenCalledWith(expect.objectContaining({
      id: notification!.id,
      title: 'Alice',
      to: '/mail/1',
      category: 'mail-new'
    }))
  })

  it('does not push an in-app notification', async () => {
    mocks.getSettings.mockResolvedValue(settings('in-app'))

    await notify({ category: 'mail-new', title: 'Alice', domain: 'mail' })

    expect(mocks.sendPush).not.toHaveBeenCalled()
  })

  it('does not push while do-not-disturb is on', async () => {
    mocks.getSettings.mockResolvedValue(settings('both', true))

    const notification = await notify({ category: 'mail-new', title: 'Alice', domain: 'mail' })

    // The bell still gets it; only the desktop delivery is suppressed
    expect(notification).toBeDefined()
    expect(mocks.sendPush).not.toHaveBeenCalled()
  })

  it('sends nothing at all for a category switched off', async () => {
    mocks.getSettings.mockResolvedValue(settings('off'))

    await expect(notify({ category: 'mail-new', title: 'Alice', domain: 'mail' })).resolves.toBeUndefined()

    expect(mocks.sendPush).not.toHaveBeenCalled()
  })
})
