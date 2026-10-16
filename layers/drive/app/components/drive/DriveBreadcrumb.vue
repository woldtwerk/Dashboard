<script setup lang="ts">
import type { DriveSection } from '#layers/drive/shared/types/drive'
import { breadcrumbs } from '#layers/drive/shared/drive-path'

const props = defineProps<{
  path: string
  section: DriveSection
}>()

const emit = defineEmits<{
  navigate: [path: string]
}>()

const crumbs = computed(() => breadcrumbs(props.path).map((crumb, index) => ({
  ...crumb,
  label: index === 0 && crumb.path === props.section.root ? props.section.label : crumb.name
})))
</script>

<template>
  <nav class="flex min-w-0 items-center gap-1 text-sm" aria-label="Breadcrumb">
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-md px-2 py-1 font-medium hover:bg-elevated"
      @click="emit('navigate', section.root)"
    >
      <UIcon :name="section.icon" class="size-4 shrink-0" />
      {{ section.label }}
    </button>

    <template v-for="crumb in crumbs.slice(1)" :key="crumb.path">
      <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
      <button
        type="button"
        class="truncate rounded-md px-2 py-1 text-muted hover:bg-elevated hover:text-default"
        @click="emit('navigate', crumb.path)"
      >
        {{ crumb.label }}
      </button>
    </template>
  </nav>
</template>
