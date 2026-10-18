<script setup lang="ts">
import { useDebounceFn, useIntervalFn, useNow } from '@vueuse/core'
import { addDays, format, isSameMonth, startOfDay } from 'date-fns'
import type { Calendar, CalendarEvent, CalendarEventInput, CalendarList, CalendarSyncStatus, EventScope } from '#layers/calendar/shared/types/calendar'

useSeoMeta({ title: 'Calendar' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const nuxtApp = useNuxtApp()

// The time zone every view renders in; see useCalendarTimeZone
const timeZone = useCalendarTimeZone()

const { data: allServices } = await useServices()
const services = computed(() => allServices.value.filter(item => item.domain === 'calendar'))

if (!services.value.length) {
  await navigateTo('/services/new', { replace: true })
}

const { data: calendarLists, refresh: refreshCalendars } = await useFetch<CalendarList[]>('/api/calendar/calendars', { default: () => [] })
const calendars = computed<Calendar[]>(() => calendarLists.value.flatMap(list => list.calendars))
const calendarByUrl = computed(() => new Map(calendars.value.map(calendar => [calendar.url, calendar])))
// Visibility is persisted server side; a calendar is shown unless it is hidden
const visibleCalendars = computed(() => calendars.value.filter(calendar => !calendar.hidden))

// View and anchor date live in the URL, so views can be linked
const queryString = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : undefined

function updateQuery(patch: Record<string, string | null>) {
  router.replace({ query: Object.fromEntries(Object.entries({ ...route.query, ...patch }).filter(([, value]) => value)) })
}

const viewState = computed(() => viewFromQuery(route.query, timeZone.value))
const view = computed(() => viewState.value.view)
const anchor = computed(() => viewState.value.date)
const window = computed(() => viewWindow(view.value, anchor.value, timeZone.value))

const currentView = computed({
  get: () => view.value,
  set: value => updateQuery({ view: value === 'month' ? null : value })
})

function go(direction: number) {
  updateQuery({ date: dateKey(shiftDate(view.value, anchor.value, direction, timeZone.value), timeZone.value) })
}

function goToday() {
  updateQuery({ date: dateKey(new Date(), timeZone.value) })
}

// The events key is the window, so a window hovered over can be prefetched into
// the same payload cache the fetch reads from
const eventsKey = (start: Date, end: Date) => `calendar-events:${toIso(start)}:${toIso(end)}`

const { data: events, refresh: refreshEvents } = await useFetch<CalendarEvent[]>('/api/calendar/events', {
  key: () => eventsKey(window.value.start, window.value.end),
  query: computed(() => ({ start: toIso(window.value.start), end: toIso(window.value.end) })),
  // A hovered window is served from the payload cache; a manual refresh
  // bypasses `getCachedData` and still hits the network
  getCachedData: key => nuxtApp.payload.data[key],
  default: () => []
})

const visibleUrls = computed(() => new Set(visibleCalendars.value.map(calendar => calendar.url)))
const visibleEvents = computed(() => events.value.filter(event => visibleUrls.value.has(event.calendar)))

const colorOf = (url: string) => calendarByUrl.value.get(url)?.color

// --- Syncing ---

const { data: syncStatus } = await useFetch<CalendarSyncStatus[]>('/api/calendar/sync-status', {
  default: () => [],
  lazy: true
})

// The initial status drives the spinner; domain events switch it off instead of polling
const syncing = ref(false)
watch(syncStatus, (value) => {
  syncing.value = value.some(status => status.syncing)
}, { immediate: true })

const refreshFromEvents = useDebounceFn(() => {
  refreshEvents()
  refreshCalendars()
}, 300)

useDomainEvents({ domains: ['calendar'] }, (event) => {
  if (event.type === 'synced' || event.type === 'sync-failed') {
    syncing.value = false
  }
  if (calendarRefreshFor(event)) {
    refreshFromEvents()
  }
}, {
  onReconnect: () => refreshFromEvents()
})

// --- Views ---

const now = useNow({ scheduler: update => useIntervalFn(update, 60_000) })
const weeks = computed(() => monthGrid(anchor.value, timeZone.value))
const columnDays = computed(() => {
  const days = view.value === 'day' ? 1 : 7
  return Array.from({ length: days }, (_, index) => addDays(window.value.start, index))
})
const gridTemplate = computed(() => `3.5rem repeat(${columnDays.value.length}, minmax(0, 1fr))`)

const agendaDays = computed(() => {
  const start = startOfDay(zoned(anchor.value, timeZone.value))
  return groupEventsByDay(
    visibleEvents.value,
    Array.from({ length: 30 }, (_, index) => addDays(start, index)),
    timeZone.value
  ).filter(group => group.events.length)
})

const monthCells = computed(() => {
  const cells = new Map<string, { visible: CalendarEvent[], overflow: CalendarEvent[] }>()
  for (const week of weeks.value) {
    for (const day of week) {
      cells.set(dateKey(day, timeZone.value), monthCell(visibleEvents.value, day, timeZone.value))
    }
  }
  return cells
})
const cellFor = (day: Date) => monthCells.value.get(dateKey(day, timeZone.value))!

const positionedByDay = computed(() => {
  const positions = new Map<string, ReturnType<typeof layoutDay>>()
  for (const day of columnDays.value) {
    positions.set(dateKey(day, timeZone.value), layoutDay(visibleEvents.value, day, timeZone.value))
  }
  return positions
})
const positionedEvents = (day: Date) => positionedByDay.value.get(dateKey(day, timeZone.value)) ?? []

const allDayByDay = computed(() => {
  const byDay = new Map<string, CalendarEvent[]>()
  for (const day of columnDays.value) {
    byDay.set(dateKey(day, timeZone.value), allDayLaneEvents(visibleEvents.value, day, timeZone.value))
  }
  return byDay
})
const allDayEventsFor = (day: Date) => allDayByDay.value.get(dateKey(day, timeZone.value)) ?? []

const isToday = (day: Date) => dateKey(day, timeZone.value) === dateKey(now.value, timeZone.value)
const dayNumber = (day: Date) => zoned(day, timeZone.value).getDate()

const nowTop = computed(() => {
  const current = zoned(now.value, timeZone.value)
  return (current.getHours() * 60 + current.getMinutes()) * (HOUR_HEIGHT / 60)
})

const HOURS = Array.from({ length: 23 }, (_, index) => index + 1)
const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`

function blockStyle(positioned: ReturnType<typeof layoutDay>[number]) {
  const width = 100 / positioned.columns

  return {
    top: `${positioned.top + 1}px`,
    height: `${Math.max(positioned.height - 2, 16)}px`,
    insetInlineStart: `calc(${positioned.column * width}% + 1px)`,
    width: `calc(${width}% - 2px)`,
    borderInlineStartColor: colorOf(positioned.event.calendar) || undefined
  }
}

function onColumnClick(pointer: MouseEvent, day: Date) {
  const element = pointer.currentTarget as HTMLElement
  const offset = pointer.clientY - element.getBoundingClientRect().top
  newEventOn(day, Math.max(0, Math.min(23, Math.floor(offset / HOUR_HEIGHT))))
}

// Prefetch a window's events into the payload cache, so switching the view is
// instant
async function prefetchWindow(direction: number) {
  const target = shiftDate(view.value, anchor.value, direction, timeZone.value)
  const next = viewWindow(view.value, target, timeZone.value)
  const key = eventsKey(next.start, next.end)
  if (nuxtApp.payload.data[key] !== undefined) {
    return
  }

  try {
    nuxtApp.payload.data[key] = await $fetch<CalendarEvent[]>('/api/calendar/events', {
      query: { start: toIso(next.start), end: toIso(next.end) }
    })
  } catch {
    // A failed prefetch just means the navigation fetches for real
  }
}

const gridEl = ref<HTMLElement>()

function scrollToInitialHour() {
  const hour = columnDays.value.reduce(
    (earliest, day) => Math.min(earliest, initialScrollHour(visibleEvents.value, day, timeZone.value)),
    DEFAULT_SCROLL_HOUR
  )
  nextTick(() => {
    if (gridEl.value) {
      gridEl.value.scrollTop = hour * HOUR_HEIGHT
    }
  })
}

onMounted(scrollToInitialHour)
watch([view, () => toIso(window.value.start), timeZone], scrollToInitialHour)

// --- Calendars ---

const calendarItems = computed(() => calendars.value.map(calendar => ({ label: calendar.name, value: calendar.url })))
const canCreate = computed(() => calendars.value.length > 0)

// Optimistic: flip it locally, roll back and toast if the server rejects it
async function toggleCalendar(calendar: Calendar) {
  const hidden = !calendar.hidden
  const snapshot = calendarLists.value
  calendarLists.value = calendarLists.value.map(list => ({
    ...list,
    calendars: list.calendars.map(item => item.url === calendar.url && item.service === calendar.service ? { ...item, hidden } : item)
  }))

  try {
    await $fetch('/api/calendar/calendars/visibility' as string, {
      method: 'PATCH',
      body: { service: calendar.service, url: calendar.url, hidden }
    })
  } catch {
    calendarLists.value = snapshot
    toast.add({ title: 'Could not update the calendar', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

// --- Editor ---

interface EventForm {
  calendar: string
  title: string
  allDay: boolean
  start: string
  end: string
  location: string
  description: string
  recurrence: string
  reminder: string
}

const form = reactive<EventForm>({
  calendar: '',
  title: '',
  allDay: false,
  start: '',
  end: '',
  location: '',
  description: '',
  recurrence: RECURRENCE_NONE,
  reminder: REMINDER_NONE
})

// An occurrence is addressed by its UID plus the original start time, since a
// recurring series shares one UID across every occurrence.
const editorKey = computed(() => queryString('event'))
const recurrenceKey = computed(() => queryString('recurrence'))
const isEditorOpen = computed({
  get: () => !!editorKey.value,
  set: (open: boolean) => {
    if (!open) {
      updateQuery({ event: null, recurrence: null })
    }
  }
})
const editingEvent = computed(() => {
  const key = editorKey.value
  return key && key !== 'new' ? events.value.find(event => isSelectedEvent(event, key, recurrenceKey.value)) ?? null : null
})
const scope = ref<EventScope>('one')
const isOccurrenceEdit = computed(() => !!editingEvent.value?.recurring && scope.value === 'one')
const saving = ref(false)

const recurrenceItems = computed(() => recurrenceSelectItems(editingEvent.value?.recurrence))
const reminderItems = computed(() => reminderSelectItems(editingEvent.value?.reminders?.[0]))

function fromEvent(event: CalendarEvent): EventForm {
  return {
    calendar: event.calendar,
    title: event.title,
    allDay: event.allDay,
    start: toInputValue(event.start, event.allDay, timeZone.value),
    end: toInputValue(event.end, event.allDay, timeZone.value),
    location: event.location ?? '',
    description: event.description ?? '',
    recurrence: toRecurrenceSelect(event.recurrence),
    reminder: toReminderSelect(event.reminders?.[0])
  }
}

// The day a new event starts on; the URL watcher needs it once `event=new` lands
const pendingDay = ref<Date>()
const pendingHour = ref<number>()

function resetForm(day?: Date, hour = 9) {
  const start = zonedHour(day ?? anchor.value, hour, timeZone.value)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  Object.assign(form, {
    calendar: visibleCalendars.value[0]?.url ?? calendars.value[0]?.url ?? '',
    title: '',
    allDay: false,
    start: toInputValue(toIso(start), false, timeZone.value),
    end: toInputValue(toIso(end), false, timeZone.value),
    location: '',
    description: '',
    recurrence: RECURRENCE_NONE,
    reminder: REMINDER_NONE
  })
}

function newEventOn(day?: Date, hour?: number) {
  pendingDay.value = day
  pendingHour.value = hour
  if (editorKey.value === 'new') {
    resetForm(day, hour)
  } else {
    updateQuery({ event: 'new', recurrence: null })
  }
}

function openEvent(event: CalendarEvent) {
  updateQuery({ event: event.uid, recurrence: event.recurrenceId ?? null })
}

watch([editorKey, recurrenceKey], ([key, recurrence]) => {
  scope.value = 'one'
  if (key === 'new') {
    resetForm(pendingDay.value, pendingHour.value)
    return
  }
  if (key) {
    const event = events.value.find(item => isSelectedEvent(item, key, recurrence))
    if (event) {
      Object.assign(form, fromEvent(event))
    }
  }
})

const SCOPE_ITEMS: { label: string, value: EventScope }[] = [
  { label: 'This event', value: 'one' },
  { label: 'All events', value: 'all' }
]

function toInput(): CalendarEventInput {
  const reminder = fromReminderSelect(form.reminder)

  return {
    calendar: form.calendar,
    title: form.title.trim(),
    start: fromInputValue(form.start, form.allDay, timeZone.value),
    end: fromInputValue(form.end, form.allDay, timeZone.value),
    allDay: form.allDay,
    location: form.location.trim() || undefined,
    description: form.description.trim() || undefined,
    // An empty rule removes the recurrence; a single-occurrence edit ignores it
    recurrence: fromRecurrenceSelect(form.recurrence),
    reminders: reminder === undefined ? [] : [reminder]
  }
}

/** The scope a write uses; a plain event only ever has the whole series. */
function scopeFor(event: CalendarEvent): EventScope {
  return event.recurring ? scope.value : 'all'
}

async function save() {
  const input = toInput()
  saving.value = true
  try {
    const existing = editingEvent.value
    if (existing) {
      const snapshot = events.value
      const effectiveScope = scopeFor(existing)
      const affected = (item: CalendarEvent) => effectiveScope === 'one'
        ? isSelectedEvent(item, existing.uid, existing.recurrenceId)
        : item.uid === existing.uid

      events.value = events.value.map(item => affected(item) ? { ...item, ...input, uid: item.uid, recurrenceId: item.recurrenceId } : item)
      try {
        await $fetch(`/api/calendar/events/${encodeURIComponent(existing.uid)}`, {
          method: 'PUT',
          body: {
            ...input,
            service: existing.service,
            calendar: existing.calendar,
            url: existing.url,
            etag: existing.etag,
            scope: effectiveScope,
            recurrenceId: existing.recurrenceId ?? existing.start
          }
        })
        await refreshEvents()
      } catch {
        events.value = snapshot
        throw new Error('update')
      }
    } else {
      const service = calendarByUrl.value.get(form.calendar)?.service
      const temp: CalendarEvent = {
        uid: `temp-${Date.now()}`,
        calendar: form.calendar,
        service,
        title: input.title,
        start: input.start,
        end: input.end,
        allDay: !!input.allDay,
        description: input.description,
        location: input.location,
        recurrence: input.recurrence || undefined,
        reminders: input.reminders
      }
      events.value = [...events.value, temp]
      try {
        const created = await $fetch<CalendarEvent>('/api/calendar/events', { method: 'POST', body: { ...input, service } })
        events.value = events.value.map(event => event.uid === temp.uid ? created : event)
        await refreshEvents()
      } catch {
        events.value = events.value.filter(event => event.uid !== temp.uid)
        throw new Error('create')
      }
    }
    isEditorOpen.value = false
    toast.add({ title: existing ? 'Event updated' : 'Event created', color: 'success', icon: 'i-lucide-check-circle' })
  } catch {
    toast.add({ title: 'Could not save the event', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    saving.value = false
  }
}

async function remove() {
  const event = editingEvent.value
  if (!event) {
    return
  }
  const snapshot = events.value
  const effectiveScope = scopeFor(event)
  events.value = effectiveScope === 'one'
    ? events.value.filter(item => !isSelectedEvent(item, event.uid, event.recurrenceId))
    : events.value.filter(item => item.uid !== event.uid)
  isEditorOpen.value = false
  try {
    await $fetch(`/api/calendar/events/${encodeURIComponent(event.uid)}`, {
      method: 'DELETE',
      body: {
        service: event.service,
        calendar: event.calendar,
        url: event.url,
        etag: event.etag,
        scope: effectiveScope,
        recurrenceId: event.recurrenceId ?? event.start
      }
    })
    await refreshEvents()
    toast.add({ title: 'Event deleted', color: 'success', icon: 'i-lucide-trash-2' })
  } catch {
    events.value = snapshot
    toast.add({ title: 'Could not delete the event', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
</script>

<template>
  <UDashboardPanel id="calendar">
    <UDashboardNavbar title="Calendar">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>

      <template #right>
        <UTooltip v-if="syncing" text="Syncing…">
          <UIcon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin text-dimmed" />
        </UTooltip>
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Previous"
          @pointerenter="prefetchWindow(-1)"
          @focus="prefetchWindow(-1)"
          @click="go(-1)"
        />
        <UButton
          label="Today"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="goToday"
        />
        <UButton
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Next"
          @pointerenter="prefetchWindow(1)"
          @focus="prefetchWindow(1)"
          @click="go(1)"
        />
        <UTabs
          v-model="currentView"
          :items="CALENDAR_VIEWS"
          :content="false"
          size="xs"
        />
        <UButton
          label="New event"
          icon="i-lucide-plus"
          size="sm"
          :disabled="!canCreate"
          @click="newEventOn()"
        />
      </template>
    </UDashboardNavbar>

    <UDashboardToolbar v-if="calendars.length > 1">
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          v-for="calendar in calendars"
          :key="calendar.url"
          :label="calendar.name"
          size="xs"
          :color="calendar.hidden ? 'neutral' : 'primary'"
          :variant="calendar.hidden ? 'ghost' : 'soft'"
          @click="toggleCalendar(calendar)"
        >
          <template #leading>
            <span class="size-2.5 rounded-full" :style="{ backgroundColor: calendar.color || 'currentColor' }" />
          </template>
        </UButton>
      </div>
    </UDashboardToolbar>

    <UEmpty
      v-if="!calendars.length"
      icon="i-lucide-calendar"
      title="No calendars"
      description="Add a calendar service to see your events here."
      :actions="[{ label: 'Add service', to: '/services/new', color: 'primary', variant: 'soft' }]"
      variant="naked"
      class="py-12"
    />

    <!-- Month -->
    <div v-else-if="view === 'month'" class="flex min-h-0 flex-1 flex-col">
      <div class="grid shrink-0 grid-cols-7 border-b border-default text-center text-xs font-medium text-muted">
        <div v-for="label in WEEKDAYS" :key="label" class="border-r border-default py-2 last:border-r-0">
          {{ label }}
        </div>
      </div>
      <div class="grid min-h-0 flex-1 grid-cols-7" style="grid-template-rows: repeat(6, minmax(0, 1fr))">
        <template v-for="(week, weekIndex) in weeks" :key="weekIndex">
          <div
            v-for="day in week"
            :key="day.toISOString()"
            class="flex min-h-0 flex-col gap-px overflow-hidden border-b border-r border-default p-1.5 last:border-r-0"
            :class="!isSameMonth(zoned(day, timeZone), zoned(anchor, timeZone)) && 'bg-elevated/30'"
          >
            <button
              class="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] leading-none hover:bg-elevated"
              :class="isToday(day) && 'bg-primary text-inverted'"
              @click="newEventOn(day)"
            >
              {{ dayNumber(day) }}
            </button>
            <button
              v-for="event in cellFor(day).visible"
              :key="eventKey(event)"
              class="flex w-full shrink-0 items-center gap-1 truncate rounded px-1 py-px text-left text-[11px] leading-4 hover:bg-elevated"
              @click="openEvent(event)"
            >
              <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: colorOf(event.calendar) || 'currentColor' }" />
              <span class="truncate">{{ event.allDay ? event.title : `${formatEventStart(event, timeZone)} ${event.title}` }}</span>
            </button>
            <UPopover v-if="cellFor(day).overflow.length" :content="{ align: 'start' }">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                class="w-full shrink-0 justify-start px-1 py-px text-[11px] leading-4 font-normal text-muted"
              >
                +{{ cellFor(day).overflow.length }} more
              </UButton>
              <template #content>
                <div class="w-64 space-y-0.5 p-2">
                  <button
                    v-for="event in cellFor(day).overflow"
                    :key="eventKey(event)"
                    class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-elevated"
                    @click="openEvent(event)"
                  >
                    <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: colorOf(event.calendar) || 'currentColor' }" />
                    <span class="w-24 shrink-0 text-xs text-muted">{{ event.allDay ? 'All day' : formatEventTime(event, timeZone) }}</span>
                    <span class="truncate">{{ event.title }}</span>
                  </button>
                </div>
              </template>
            </UPopover>
          </div>
        </template>
      </div>
    </div>

    <!-- Week and day -->
    <div v-else-if="view === 'week' || view === 'day'" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 overflow-hidden border-b border-default [scrollbar-gutter:stable]">
        <div class="grid" :style="{ gridTemplateColumns: gridTemplate }">
          <div />
          <div
            v-for="day in columnDays"
            :key="day.toISOString()"
            class="border-l border-default px-2 py-1.5 text-center text-xs font-medium"
            :class="isToday(day) && 'text-primary'"
          >
            {{ format(zoned(day, timeZone), 'EEE d MMM') }}
          </div>
        </div>
        <div class="grid border-t border-default" :style="{ gridTemplateColumns: gridTemplate }">
          <div class="px-1 py-1 text-end text-[10px] text-dimmed">
            all-day
          </div>
          <div
            v-for="day in columnDays"
            :key="`all-day-${day.toISOString()}`"
            class="flex min-h-6 flex-col gap-0.5 border-l border-default p-0.5"
            @click="newEventOn(day)"
          >
            <button
              v-for="event in allDayEventsFor(day)"
              :key="eventKey(event)"
              class="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-xs hover:bg-elevated"
              @click.stop="openEvent(event)"
            >
              <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: colorOf(event.calendar) || 'currentColor' }" />
              <span class="truncate">{{ allDayLaneLabel(event, day, timeZone) }}</span>
            </button>
          </div>
        </div>
      </div>

      <div ref="gridEl" class="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div class="grid" :style="{ gridTemplateColumns: gridTemplate }">
          <div
            class="sticky left-0 z-10 bg-default"
            :style="{ height: `${DAY_MINUTES / 60 * HOUR_HEIGHT}px` }"
          >
            <span
              v-for="hour in HOURS"
              :key="hour"
              class="absolute end-2 -translate-y-1/2 text-[11px] text-dimmed tabular-nums"
              :style="{ top: `${hour * HOUR_HEIGHT}px` }"
            >
              {{ formatHour(hour) }}
            </span>
          </div>
          <div
            v-for="day in columnDays"
            :key="day.toISOString()"
            class="relative border-l border-default"
            :style="{ height: `${DAY_MINUTES / 60 * HOUR_HEIGHT}px` }"
            @click="onColumnClick($event, day)"
          >
            <div
              v-for="hour in HOURS"
              :key="hour"
              class="pointer-events-none absolute inset-x-0 border-t border-default"
              :style="{ top: `${hour * HOUR_HEIGHT}px` }"
            />
            <button
              v-for="positioned in positionedEvents(day)"
              :key="eventKey(positioned.event)"
              class="absolute overflow-hidden rounded border border-default bg-default px-1.5 py-0.5 text-left text-xs hover:z-10 hover:bg-elevated"
              :style="blockStyle(positioned)"
              @click.stop="openEvent(positioned.event)"
            >
              <span class="block truncate font-medium">{{ positioned.event.title }}</span>
              <span class="block truncate text-[10px] text-muted">{{ formatEventTime(positioned.event, timeZone) }}</span>
            </button>
            <ClientOnly>
              <div
                v-if="isToday(day)"
                class="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-error"
                :style="{ top: `${nowTop}px` }"
              >
                <div class="absolute -top-[5px] -start-1 size-2 rounded-full bg-error" />
              </div>
            </ClientOnly>
          </div>
        </div>
      </div>
    </div>

    <!-- Agenda -->
    <div v-else class="min-h-0 flex-1 divide-y divide-default overflow-y-auto">
      <UEmpty
        v-if="!agendaDays.length"
        icon="i-lucide-calendar-x"
        title="Nothing scheduled"
        description="No events in the next 30 days."
        variant="naked"
        class="py-12"
      />
      <div v-for="group in agendaDays" :key="group.day.toISOString()" class="flex gap-4 p-4 sm:px-6">
        <div class="w-28 shrink-0 text-sm text-muted">
          {{ format(zoned(group.day, timeZone), 'EEE, d MMM') }}
        </div>
        <div class="min-w-0 flex-1 space-y-1">
          <button
            v-for="event in group.events"
            :key="eventKey(event)"
            class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-elevated"
            @click="openEvent(event)"
          >
            <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: colorOf(event.calendar) || 'currentColor' }" />
            <span class="w-24 shrink-0 text-xs text-muted">{{ event.allDay ? 'All day' : formatEventTime(event, timeZone) }}</span>
            <span class="truncate font-medium">{{ event.title }}</span>
            <span v-if="event.location" class="truncate text-sm text-dimmed">{{ event.location }}</span>
          </button>
        </div>
      </div>
    </div>
  </UDashboardPanel>

  <USlideover v-model:open="isEditorOpen" :title="editingEvent ? 'Edit event' : 'New event'">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <UFormField label="Title" required>
          <UInput v-model="form.title" class="w-full" placeholder="Event title" />
        </UFormField>

        <UFormField label="Calendar" required>
          <USelect v-model="form.calendar" :items="calendarItems" class="w-full" />
        </UFormField>

        <UFormField v-if="editingEvent?.recurring" label="Apply to">
          <UTabs
            v-model="scope"
            :items="SCOPE_ITEMS"
            :content="false"
            size="xs"
          />
        </UFormField>

        <USwitch v-model="form.allDay" label="All day" />

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Starts">
            <UInput v-model="form.start" :type="form.allDay ? 'date' : 'datetime-local'" class="w-full" />
          </UFormField>
          <UFormField label="Ends">
            <UInput v-model="form.end" :type="form.allDay ? 'date' : 'datetime-local'" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Location">
          <UInput v-model="form.location" class="w-full" />
        </UFormField>

        <UFormField label="Description">
          <UTextarea v-model="form.description" :rows="3" class="w-full" />
        </UFormField>

        <UFormField v-if="!isOccurrenceEdit" label="Repeats">
          <USelect v-model="form.recurrence" :items="recurrenceItems" class="w-full" />
        </UFormField>

        <UFormField label="Reminder">
          <USelect v-model="form.reminder" :items="reminderItems" class="w-full" />
        </UFormField>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between">
        <div v-if="editingEvent" class="flex items-center gap-1">
          <GraphLinkButton
            :entity="{
              type: 'event',
              service: editingEvent.service,
              id: `${editingEvent.calendar}|${editingEvent.uid}|${editingEvent.recurrenceId ?? ''}`
            }"
          />
          <UButton
            label="Delete"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            @click="remove"
          />
        </div>
        <span v-else />
        <div class="flex gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="isEditorOpen = false"
          />
          <UButton
            label="Save"
            :loading="saving"
            :disabled="!form.title || !form.calendar"
            @click="save"
          />
        </div>
      </div>
    </template>
  </USlideover>
</template>
