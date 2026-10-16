<script setup lang="ts">
const { navigation } = useDashboard()

const modules = computed(() => navigation.value.filter(item => item.domain))
</script>

<template>
  <UDashboardPanel id="home">
    <template #header>
      <UDashboardNavbar title="Home">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UEmpty
        v-if="!modules.length"
        icon="i-lucide-layout-dashboard"
        title="Welcome to Allmight"
        description="Add your first service, e.g. a mail account, to fill your dashboard."
        :actions="[{ label: 'Add service', icon: 'i-lucide-plus', to: '/services/new' }]"
      />

      <div
        v-else
        class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        <UPageCard
          v-for="item in modules"
          :key="item.to"
          :title="item.label"
          :description="item.description"
          :icon="item.icon"
          :to="item.to"
          variant="subtle"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
