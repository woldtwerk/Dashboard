<script setup lang="ts">
import { addDays, format, parseISO, startOfDay } from 'date-fns'
import type { CalendarEvent } from '#layers/calendar/shared/types/calendar'
import { zoned } from '../../utils/calendar-view'
import { useCalendarTimeZone } from '../../composables/useCalendarTimeZone'

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
</script>

<template>
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
</template>
