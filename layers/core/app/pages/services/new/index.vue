<script setup lang="ts">
useSeoMeta({ title: 'Add service' })

const { data: connectors } = await useFetch('/api/connectors', { default: () => [] })
</script>

<template>
  <UDashboardPanel id="services-new">
    <template #header>
      <UDashboardNavbar title="Add service">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <UPageCard
          v-for="connector in connectors"
          :key="connector.id"
          :title="connector.title"
          :description="connector.description"
          :icon="connector.icon"
          :to="`/services/new/${connector.id}`"
          variant="subtle"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
