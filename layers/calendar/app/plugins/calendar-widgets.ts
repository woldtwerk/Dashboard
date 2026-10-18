import { defineAsyncComponent } from 'vue'
import { defineDashboardWidget } from '#layers/core/app/utils/dashboard-widgets'

export default defineNuxtPlugin(() => {
  defineDashboardWidget({
    id: 'calendar-upcoming',
    domain: 'calendar',
    title: 'Upcoming',
    icon: 'i-lucide-calendar-days',
    component: defineAsyncComponent(() => import('../components/dashboard/CalendarUpcomingWidget.vue')),
    order: 20,
    span: 1,
    to: '/calendar'
  })
})
