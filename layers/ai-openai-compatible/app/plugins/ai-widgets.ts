import { defineAsyncComponent } from 'vue'
import { defineDashboardWidget } from '#layers/core/app/utils/dashboard-widgets'

export default defineNuxtPlugin(() => {
  defineDashboardWidget({
    id: 'opencode-usage',
    domain: 'ai',
    title: 'OpenCode',
    icon: 'i-lucide-sparkles',
    component: defineAsyncComponent(() => import('../components/dashboard/OpenCodeUsageWidget.vue')),
    order: 20,
    span: 2,
    to: '/services'
  })
})
