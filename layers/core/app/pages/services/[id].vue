<script setup lang="ts">
import type { SetupState } from '#layers/core/shared/types/setup'

const route = useRoute()

const { data: state } = await useFetch<SetupState>(() => `/api/services/${route.params.id}`)

if (!state.value) {
  throw createError({ statusCode: 404, statusMessage: 'Service not found', fatal: true })
}

useSeoMeta({ title: state.value.service?.name })
</script>

<template>
  <UDashboardPanel id="services-edit">
    <template #header>
      <UDashboardNavbar :title="state!.service?.name">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <SetupWizard :state="state!" />
    </template>
  </UDashboardPanel>
</template>
