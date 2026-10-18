<script setup lang="ts">
const route = useRoute()
const router = useRouter()

useSeoMeta({ title: 'Settings' })

const sections = getSettingsSections()
const sectionId = computed(() => {
  const requested = typeof route.query.section === 'string' ? route.query.section : undefined
  return sections.some(section => section.id === requested) ? requested : sections[0]?.id
})
const current = computed(() => sections.find(section => section.id === sectionId.value))

function select(id: string) {
  router.replace({ query: { ...route.query, section: id } })
}
</script>

<template>
  <UDashboardPanel id="settings">
    <template #header>
      <UDashboardNavbar title="Settings">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav class="space-y-1">
          <button
            v-for="section in sections"
            :key="section.id"
            class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors"
            :class="section.id === sectionId ? 'bg-elevated font-medium text-highlighted' : 'text-muted hover:bg-elevated/60 hover:text-highlighted'"
            @click="select(section.id)"
          >
            <UIcon :name="section.icon" class="size-4 shrink-0" />
            <span class="truncate">{{ section.label }}</span>
          </button>
        </nav>

        <component :is="current?.component" v-if="current" :key="current.id" />
      </div>
    </template>
  </UDashboardPanel>
</template>
