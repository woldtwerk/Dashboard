<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const props = withDefaults(defineProps<{
  title: string
  empty?: boolean
  loading?: boolean
  columns: TableColumn<Record<string, unknown>>[]
  rows: Record<string, unknown>[]
}>(), {
  empty: false,
  loading: false
})

const view = ref<'chart' | 'table'>('chart')

const items = [
  { label: 'Chart', value: 'chart' },
  { label: 'Table', value: 'table' }
]

watch(() => props.empty, (empty) => {
  if (empty) {
    view.value = 'chart'
  }
})
</script>

<template>
  <UCard :ui="{ body: 'p-4 sm:p-5' }">
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-sm font-semibold text-highlighted">
          {{ title }}
        </h2>
        <UTabs
          v-model="view"
          :items="items"
          :content="false"
          size="xs"
          :ui="{ trigger: 'px-2 py-1 text-xs' }"
        />
      </div>
    </template>

    <USkeleton v-if="loading" class="h-60 w-full" />

    <UEmpty
      v-else-if="empty"
      icon="i-lucide-chart-no-axes-column"
      title="No data yet"
      description="This chart fills up once the service has some history."
      variant="naked"
      class="py-12"
    />

    <UTable
      v-else-if="view === 'table'"
      :data="rows"
      :columns="columns"
      class="w-full"
    />

    <slot v-else />
  </UCard>
</template>
