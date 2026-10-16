<script setup lang="ts">
import { addDays, addHours, format, isSameMonth, parseISO, setHours, startOfDay } from 'date-fns'
import type { Calendar, CalendarEvent, CalendarEventInput, CalendarList, EventScope } from '#layers/calendar/shared/types/calendar'

useSeoMeta({ title: 'Calendar' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

const { data: allServices } = await useServices()
const services = computed(() => allServices.value.filter(item => item.domain === 'calendar'))

if (!services.value.length) {
  await navigateTo('/services/new', { replace: true })
}

const { data: calendarLists } = await useFetch<CalendarList[]>('/api/calendar/calendars', { default: () => [] })
const calendars = computed<Calendar[]>(() => calendarLists.value.flatMap(list => list.calendars))
const calendarByUrl = computed(() => new Map(calendars.value.map(calendar => [calendar.url, calendar])))

// View and anchor date live in the URL, so views can be linked
const queryString = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : undefined

function updateQuery(patch: Record<string, string | null>) {
  router.replace({ query: Object.fromEntries(Object.entries({ ...route.query, ...patch }).filter(([, value]) => value)) })
}

const viewState = computed(() => viewFromQuery(route.query))
const view = computed(() => viewState.value.view)
const anchor = computed(() => viewState.value.date)
const window = computed(() => viewWindow(view.value, anchor.value))

const currentView = computed({
  get: () => view.value,
  set: value => updateQuery({ view: value === 'month' ? null : value })
})

function go(direction: number) {
  updateQuery({ date: dateKey(shiftDate(view.value, anchor.value, direction)) })
}

function goToday() {
  updateQuery({ date: dateKey(new Date()) })
}

// Calendar selection lives in the URL; without it, every calendar is shown
const selectedCalendars = computed<string[]>(() => {
  const raw = queryString('calendars')
  if (raw === '__none__') {
    return []
  }
  return raw ? raw.split(',').filter(Boolean) : calendars.value.map(calendar => calendar.url)
})

const isCalendarOn = (url: string) => selectedCalendars.value.includes(url)

function toggleCalendar(url: string) {
  const current = new Set(selectedCalendars.value)
  if (current.has(url)) {
    current.delete(url)
  } else {
    current.add(url)
  }
  const all = calendars.value.map(calendar => calendar.url)
  const kept = all.filter(item => current.has(item))
  updateQuery({ calendars: kept.length === all.length ? null : kept.length ? kept.join(',') : '__none__' })
}

const { data: events, refresh } = await useFetch<CalendarEvent[]>('/api/calendar/events', {
  query: computed(() => ({ start: window.value.start.toISOString(), end: window.value.end.toISOString() })),
  default: () => []
})

const visibleEvents = computed(() => events.value.filter(event => selectedCalendars.value.includes(event.calendar)))

const colorOf = (url: string) => calendarByUrl.value.get(url)?.color

const weeks = computed(() => monthGrid(anchor.value))
const columnDays = computed(() => {
  const days = view.value === 'day' ? 1 : 7
  return Array.from({ length: days }, (_, index) => addDays(window.value.start, index))
})
const agendaDays = computed(() => groupEventsByDay(
  visibleEvents.value,
  Array.from({ length: 30 }, (_, index) => addDays(startOfDay(anchor.value), index))
).filter(group => group.events.length))

const calendarItems = computed(() => calendars.value.map(calendar => ({ label: calendar.name, value: calendar.url })))
const canCreate = computed(() => calendars.value.length > 0)

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
  recurrence: '',
  reminder: ''
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

function toLocalInput(date: Date): string {
  return format(date, 'yyyy-MM-dd\'T\'HH:mm')
}

function fromEvent(event: CalendarEvent) {
  return {
    calendar: event.calendar,
    title: event.title,
    allDay: event.allDay,
    start: event.allDay ? format(parseISO(event.start), 'yyyy-MM-dd') : toLocalInput(parseISO(event.start)),
    end: event.allDay ? format(parseISO(event.end), 'yyyy-MM-dd') : toLocalInput(parseISO(event.end)),
    location: event.location ?? '',
    description: event.description ?? '',
    recurrence: event.recurrence ?? '',
    reminder: event.reminders?.[0] !== undefined ? String(event.reminders[0]) : ''
  }
}

// The day a new event starts on; the URL watcher needs it once `event=new` lands
const pendingDay = ref<Date>()

function resetForm(day?: Date) {
  const start = setHours(startOfDay(day ?? anchor.value), 9)
  Object.assign(form, {
    calendar: selectedCalendars.value[0] ?? calendars.value[0]?.url ?? '',
    title: '',
    allDay: false,
    start: toLocalInput(start),
    end: toLocalInput(addHours(start, 1)),
    location: '',
    description: '',
    recurrence: '',
    reminder: ''
  })
}

function newEventOn(day?: Date) {
  pendingDay.value = day
  if (editorKey.value === 'new') {
    resetForm(day)
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
    resetForm(pendingDay.value)
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

const REMINDERS = [
  { label: 'None', value: '' },
  { label: 'At start', value: '0' },
  { label: '5 minutes before', value: '5' },
  { label: '15 minutes before', value: '15' },
  { label: '30 minutes before', value: '30' },
  { label: '1 hour before', value: '60' },
  { label: '1 day before', value: '1440' }
]

function toIso(value: string, allDay: boolean): string {
  return allDay ? new Date(`${value}T00:00:00Z`).toISOString() : new Date(value).toISOString()
}

function toInput(): CalendarEventInput {
  return {
    calendar: form.calendar,
    title: form.title.trim(),
    start: toIso(form.start, form.allDay),
    end: toIso(form.end, form.allDay),
    allDay: form.allDay,
    location: form.location.trim() || undefined,
    description: form.description.trim() || undefined,
    // An empty rule removes the recurrence; a single-occurrence edit ignores it
    recurrence: form.recurrence,
    reminders: form.reminder === '' ? [] : [Number(form.reminder)]
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
        await refresh()
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
        await refresh()
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
    await refresh()
    toast.add({ title: 'Event deleted', color: 'success', icon: 'i-lucide-trash-2' })
  } catch {
    events.value = snapshot
    toast.add({ title: 'Could not delete the event', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}
</script>

<template>
  <UDashboardPanel id="calendar">
    <UDashboardNavbar title="Calendar">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>

      <template #right>
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Previous"
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
          :color="isCalendarOn(calendar.url) ? 'primary' : 'neutral'"
          :variant="isCalendarOn(calendar.url) ? 'soft' : 'ghost'"
          @click="toggleCalendar(calendar.url)"
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
    <div v-else-if="view === 'month'" class="flex-1 overflow-auto">
      <div class="grid grid-cols-7 border-b border-default text-center text-xs font-medium text-muted">
        <div v-for="label in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']" :key="label" class="border-r border-default py-2 last:border-r-0">
          {{ label }}
        </div>
      </div>
      <div class="grid grid-cols-7">
        <template v-for="(week, weekIndex) in weeks" :key="weekIndex">
          <div
            v-for="day in week"
            :key="day.toISOString()"
            class="min-h-24 border-b border-r border-default p-1.5 last:border-r-0"
            :class="!isSameMonth(day, anchor) && 'bg-elevated/30'"
          >
            <button
              class="mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs hover:bg-elevated"
              :class="dateKey(day) === dateKey(new Date()) && 'bg-primary text-inverted'"
              @click="newEventOn(day)"
            >
              {{ day.getDate() }}
            </button>
            <div class="space-y-0.5">
              <button
                v-for="event in eventsForDay(visibleEvents, day).slice(0, 4)"
                :key="eventKey(event)"
                class="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-xs hover:bg-elevated"
                @click="openEvent(event)"
              >
                <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: colorOf(event.calendar) || 'currentColor' }" />
                <span class="truncate">{{ event.allDay ? event.title : `${format(parseISO(event.start), 'HH:mm')} ${event.title}` }}</span>
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Week and day -->
    <div v-else-if="view === 'week' || view === 'day'" class="flex-1 overflow-auto">
      <div class="grid h-full" :class="view === 'week' ? 'grid-cols-7' : 'grid-cols-1'">
        <div v-for="day in columnDays" :key="day.toISOString()" class="border-r border-default p-2 last:border-r-0">
          <div class="mb-2 text-xs font-medium" :class="dateKey(day) === dateKey(new Date()) && 'text-primary'">
            {{ format(day, 'EEE d MMM') }}
          </div>
          <div class="space-y-1">
            <button
              v-for="event in eventsForDay(visibleEvents, day)"
              :key="eventKey(event)"
              class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-elevated"
              @click="openEvent(event)"
            >
              <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: colorOf(event.calendar) || 'currentColor' }" />
              <span class="shrink-0 text-xs text-muted">{{ formatEventTime(event) }}</span>
              <span class="truncate">{{ event.title }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Agenda -->
    <div v-else class="flex-1 overflow-auto divide-y divide-default">
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
          {{ format(group.day, 'EEE, d MMM') }}
        </div>
        <div class="min-w-0 flex-1 space-y-1">
          <button
            v-for="event in group.events"
            :key="eventKey(event)"
            class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-elevated"
            @click="openEvent(event)"
          >
            <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: colorOf(event.calendar) || 'currentColor' }" />
            <span class="w-24 shrink-0 text-xs text-muted">{{ formatEventTime(event) }}</span>
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
          <USelect v-model="form.recurrence" :items="RECURRENCE_PRESETS" class="w-full" />
        </UFormField>

        <UFormField label="Reminder">
          <USelect v-model="form.reminder" :items="REMINDERS" class="w-full" />
        </UFormField>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between">
        <UButton
          v-if="editingEvent"
          label="Delete"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          @click="remove"
        />
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
