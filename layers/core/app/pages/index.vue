<script setup lang="ts">
import { addDays, format, parseISO, startOfDay } from 'date-fns'
import { useDebounceFn } from '@vueuse/core'
import type { TableColumn } from '@nuxt/ui'
import type { DashboardMetric, DashboardSeries, ServiceStatus } from '#layers/core/shared/types/dashboard'
import type { LogEntry } from '#layers/core/shared/types/logs'
import type { CalendarEvent } from '#layers/calendar/shared/types/calendar'
import type { BarChartPoint } from '../utils/chart'

useSeoMeta({ title: 'Home' })

const route = useRoute()
const router = useRouter()
const now = useDashboardNow()

// --- Range (URL state) ---

const days = computed(() => rangeFromQuery(route.query.days))
const rangeItems = CHART_RANGES.map(value => ({ label: `${value} days`, value }))
const range = computed({
  get: () => days.value,
  set: (value: number) => router.replace({ query: { ...route.query, days: String(value) } })
})

const dayLabel = (date: string) => format(parseISO(date), 'd MMM')
const longDayLabel = (date: string) => format(parseISO(date), 'EEE d MMM')

// --- Services ---

const { data: services, pending: servicesPending, refresh: refreshServices } = useFetch<ServiceStatus[]>('/api/dashboard/services' as string, {
  key: 'dashboard-services',
  lazy: true,
  default: () => []
})

// --- Metrics ---

const { data: metrics, pending: metricsPending, refresh: refreshMetrics } = useFetch<DashboardMetric[]>('/api/dashboard/metrics' as string, {
  key: 'dashboard-metrics',
  lazy: true,
  default: () => []
})

// --- Series ---

// The day range drives the daily charts; documents stay a fixed 12 weeks
const { data: mailSeries, pending: mailPending, refresh: refreshMail } = useFetch<DashboardSeries>('/api/dashboard/series/mail-received' as string, {
  key: 'dashboard-series-mail-received',
  query: computed(() => ({ days: days.value })),
  lazy: true
})
const { data: documentsSeries, pending: documentsPending, refresh: refreshDocuments } = useFetch<DashboardSeries>('/api/dashboard/series/documents-added' as string, {
  key: 'dashboard-series-documents-added',
  query: { days: 84 },
  lazy: true
})

const mailPoints = computed<BarChartPoint[]>(() => (mailSeries.value?.points ?? []).map(point => ({ date: point.date, value: point.value })))
const documentsPoints = computed<BarChartPoint[]>(() => (documentsSeries.value?.points ?? []).map(point => ({ date: point.date, value: point.value })))

// --- Recent logs ---

const { data: recentLogs, pending: logsPending } = useFetch<LogEntry[]>('/api/logs' as string, {
  key: 'dashboard-logs',
  query: { limit: 20 },
  lazy: true,
  default: () => []
})

// --- Upcoming (only with a calendar service) ---

const hasCalendar = computed(() => services.value.some(service => service.domain === 'calendar'))
const timeZone = useCalendarTimeZone()
const upcomingRange = computed(() => {
  const start = startOfDay(new Date())
  return { start: start.toISOString(), end: addDays(start, 7).toISOString() }
})
// Fetched during the server render too, so the markup and the hydration payload
// agree on the list instead of rendering an empty card first
const { data: upcoming } = useFetch<CalendarEvent[]>('/api/calendar/events', {
  key: 'dashboard-upcoming',
  query: computed(() => upcomingRange.value),
  lazy: true,
  default: () => []
})

const upcomingEvents = computed(() => [...upcoming.value]
  .sort((a, b) => a.start.localeCompare(b.start))
  .slice(0, 5))

// In the same zone on the server and the first client pass; see useCalendarTimeZone
const eventTime = (event: CalendarEvent) => format(
  zoned(parseISO(event.start), timeZone.value),
  event.allDay ? 'EEE d MMM' : 'EEE d MMM HH:mm'
)

// --- Table views (the charts' accessible twin) ---

const mailColumns: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'date', header: 'Date' },
  { accessorKey: 'value', header: 'Received' }
]
const mailRows = computed(() => seriesTableRows(mailSeries.value).map(point => ({ date: dayLabel(point.date), value: formatCount(point.value) })))

const documentsColumns: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'date', header: 'Week of' },
  { accessorKey: 'value', header: 'Added' }
]
const documentsRows = computed(() => seriesTableRows(documentsSeries.value).map(point => ({ date: dayLabel(point.date), value: formatCount(point.value) })))

// --- Tooltips ---

const mailTooltip = (point: BarChartPoint) => `${longDayLabel(point.date)}: ${formatCount(point.value)}`

// --- Live updates ---

const refreshFast = useDebounceFn(() => {
  refreshServices()
  refreshMail()
}, 1000)
const refreshSlow = useDebounceFn(() => {
  refreshMetrics()
  refreshDocuments()
}, 2000)

useDomainEvents({}, (event) => {
  if (event.type === 'synced' || event.type === 'sync-failed') {
    refreshFast()
  } else if (event.type === 'changed') {
    refreshSlow()
  }
}, {
  onReconnect: () => {
    refreshServices()
    refreshMetrics()
  }
})
</script>

<template>
  <UDashboardPanel id="home">
    <template #header>
      <UDashboardNavbar title="Home">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <UTabs
            v-model="range"
            :items="rangeItems"
            :content="false"
            size="xs"
          />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="space-y-4">
        <!-- Service health -->
        <UCard>
          <USkeleton v-if="servicesPending && !services.length" class="h-10 w-full" />
          <DashboardServiceHealth v-else-if="services.length" :services="services" />
          <UEmpty
            v-else
            icon="i-lucide-blocks"
            title="No services yet"
            description="Connect a service to fill your dashboard."
            variant="naked"
            :actions="[{ label: 'Add service', icon: 'i-lucide-plus', to: '/services/new' }]"
          />
        </UCard>

        <!-- Stat tiles -->
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <template v-if="metricsPending && !metrics.length">
            <USkeleton v-for="index in 4" :key="index" class="h-28 w-full" />
          </template>
          <DashboardStatTile
            v-for="metric in metrics"
            v-else
            :key="metric.id"
            :metric="metric"
          />
        </div>

        <!-- Charts -->
        <div class="grid gap-4 lg:grid-cols-2">
          <DashboardChartCard
            title="Mail received"
            :empty="!hasSeriesPoints(mailSeries)"
            :loading="mailPending && !mailSeries"
            :columns="mailColumns"
            :rows="mailRows"
          >
            <ClientOnly>
              <DashboardBarChart
                :points="mailPoints"
                color="var(--chart-mail)"
                label="Mail received per day"
                integer-y
                :format-tick="dayLabel"
                :format-tooltip="mailTooltip"
              />
              <template #fallback>
                <USkeleton class="h-60 w-full" />
              </template>
            </ClientOnly>
          </DashboardChartCard>

          <DashboardChartCard
            title="Documents added"
            :empty="!hasSeriesPoints(documentsSeries)"
            :loading="documentsPending && !documentsSeries"
            :columns="documentsColumns"
            :rows="documentsRows"
          >
            <ClientOnly>
              <DashboardBarChart
                :points="documentsPoints"
                color="var(--chart-documents)"
                label="Documents added per week"
                integer-y
                :tick-every="1"
                :format-tick="dayLabel"
                :format-tooltip="mailTooltip"
              />
              <template #fallback>
                <USkeleton class="h-60 w-full" />
              </template>
            </ClientOnly>
          </DashboardChartCard>
        </div>

        <!-- Upcoming -->
        <UCard v-if="hasCalendar">
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-sm font-semibold text-highlighted">
                Upcoming
              </h2>
              <UButton
                to="/calendar"
                label="Open calendar"
                icon="i-lucide-arrow-right"
                color="neutral"
                variant="ghost"
                size="xs"
              />
            </div>
          </template>

          <ul v-if="upcomingEvents.length" class="divide-y divide-default">
            <li
              v-for="event in upcomingEvents"
              :key="`${event.uid}-${event.start}`"
              class="flex items-center gap-3 py-2"
            >
              <span class="w-28 shrink-0 text-xs text-muted">
                {{ eventTime(event) }}
              </span>
              <span class="truncate text-sm text-highlighted">{{ event.title }}</span>
            </li>
          </ul>
          <UEmpty
            v-else
            icon="i-lucide-calendar-x"
            title="Nothing scheduled"
            description="No events in the next 7 days."
            variant="naked"
            class="py-8"
          />
        </UCard>

        <!-- Recent logs -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-sm font-semibold text-highlighted">
                Recent logs
              </h2>
              <UButton
                to="/logs"
                label="Open logs"
                icon="i-lucide-arrow-right"
                color="neutral"
                variant="ghost"
                size="xs"
              />
            </div>
          </template>

          <div v-if="logsPending && !recentLogs.length" class="space-y-2">
            <USkeleton v-for="index in 5" :key="index" class="h-8 w-full" />
          </div>
          <ul v-else-if="recentLogs.length" class="divide-y divide-default">
            <li
              v-for="entry in recentLogs"
              :key="entry.id"
              class="flex items-center gap-3 py-2"
            >
              <LogLevelBadge :level="entry.level" />
              <DomainBadge :domain="entry.domain" />
              <span v-if="entry.service" class="hidden shrink-0 text-xs text-muted sm:inline">{{ entry.service }}</span>
              <span class="shrink-0 text-xs text-muted tabular-nums">{{ formatRelative(entry.at, now) }}</span>
              <span class="min-w-0 flex-1 truncate text-sm">{{ entry.message }}</span>
            </li>
          </ul>
          <UEmpty
            v-else
            icon="i-lucide-scroll-text"
            title="No logs yet"
            description="Log lines appear here once a service runs."
            variant="naked"
            class="py-8"
          />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
