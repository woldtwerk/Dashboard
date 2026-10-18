import { defineAsyncComponent } from 'vue'
import { defineDashboardWidget } from '#layers/core/app/utils/dashboard-widgets'

export default defineNuxtPlugin(() => {
  defineDashboardWidget({
    id: 'mail-important',
    domain: 'mail',
    title: 'Important mails',
    icon: 'i-lucide-mail',
    component: defineAsyncComponent(() => import('../components/dashboard/ImportantMailsWidget.vue')),
    order: 10,
    span: 2,
    to: '/mail'
  })
})
