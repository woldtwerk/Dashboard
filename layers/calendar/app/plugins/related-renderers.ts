import { provideRelatedRenderer } from '#layers/core/app/composables/useRelatedRenderers'
import CalendarRelatedEvents from '../components/CalendarRelatedEvents.vue'

// Related events split around now, past ones collapsed
export default defineNuxtPlugin(() => {
  provideRelatedRenderer('calendar', CalendarRelatedEvents)
})
