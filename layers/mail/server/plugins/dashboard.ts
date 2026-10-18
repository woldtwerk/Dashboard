import { and, count, eq } from 'drizzle-orm'
import { fillBuckets } from '../../../core/server/utils/dashboard'
import type { DashboardMetric, ServiceStatus } from '../../../core/shared/types/dashboard'
import type { ServiceInfo } from '../../../core/shared/types/setup'
import { indexProgress } from '../../shared/mail-index-progress'
import { mailIndexMessages } from '../db/schema'

const DAY_MS = 24 * 60 * 60 * 1000

const dateKey = (date: Date) => date.toISOString().slice(0, 10)
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS)

async function status(service: ServiceInfo): Promise<Omit<ServiceStatus, 'id' | 'name' | 'domain' | 'icon'>> {
  const state = await getMailIndexStatus(service.id)

  return {
    health: state.syncing ? 'syncing' : state.complete ? 'ok' : 'unknown',
    syncedAt: state.syncedAt ?? null,
    progress: state.complete ? undefined : indexProgress(state)
  }
}

async function unread(): Promise<number | null> {
  if (!(await listServices('mail')).length) {
    return null
  }

  const db = await useDb()
  const row = await db.select({ value: count() }).from(mailIndexMessages)
    .where(and(eq(mailIndexMessages.mailbox, 'INBOX'), eq(mailIndexMessages.unread, true)))
    .get()

  return row?.value ?? 0
}

async function received(days: number) {
  const index = useMailSearchIndex()
  if (!index) {
    return []
  }

  const services = (await listServices('mail')).map(service => service.id)
  const today = new Date()
  const since = dateKey(addDays(today, -(days - 1)))
  const until = dateKey(addDays(today, 1))
  const counts = await index.countByDay({ services, since, until })

  return fillBuckets(counts.map(({ date, count }) => ({ date, value: count })), days, 'day', today)
}

export default defineNitroPlugin(() => {
  registerDashboardSource('mail', {
    status,
    async metrics(): Promise<DashboardMetric[]> {
      return [{
        id: 'mail-unread',
        domain: 'mail',
        label: 'Unread mail',
        value: await unread(),
        unit: 'count',
        icon: 'i-lucide-mail',
        to: '/mail?unread=true'
      }]
    },
    series: {
      'mail-received': {
        info: { label: 'Mail received', bucket: 'day' },
        points: received
      }
    }
  })
})
