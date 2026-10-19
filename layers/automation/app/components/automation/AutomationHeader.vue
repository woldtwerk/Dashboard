<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { useAutomationReviewCount } from '#layers/automation/app/composables/useAutomationReviewCount'

const { count, prefetch } = useAutomationReviewCount()

const links = computed<NavigationMenuItem[]>(() => [
  { label: 'Workflows', icon: 'i-lucide-workflow', to: '/automation', exact: true },
  { label: 'Activity', icon: 'i-lucide-activity', to: '/automation/activity', badge: count.value || undefined }
])
</script>

<template>
  <UDashboardNavbar title="Automation">
    <template #right>
      <slot name="actions" />
    </template>
  </UDashboardNavbar>

  <UDashboardToolbar>
    <UNavigationMenu
      :items="links"
      highlight
      class="-mx-1 flex-1"
      @mouseenter="prefetch"
      @focusin="prefetch"
    />
  </UDashboardToolbar>
</template>
