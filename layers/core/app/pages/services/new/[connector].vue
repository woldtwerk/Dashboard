<script setup lang="ts">
const route = useRoute()

const { data: state } = await useFetch(() => `/api/connectors/${route.params.connector}`)

if (!state.value) {
  throw createError({ statusCode: 404, statusMessage: 'Connector not found', fatal: true })
}

useSeoMeta({ title: `Add ${state.value.connector.title}` })
</script>

<template>
  <UDashboardPanel id="services-setup">
    <template #header>
      <UDashboardNavbar :title="`Add ${state!.connector.title}`">
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
