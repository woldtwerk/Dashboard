<script setup lang="ts">
import type { EntityRef } from '#layers/core/shared/types/entities'
import { entityKey } from '#layers/core/shared/entities'

const props = withDefaults(defineProps<{
  entity: EntityRef
  label?: string
}>(), {
  label: undefined
})

const to = computed(() => `/graph?ref=${encodeURIComponent(entityKey(props.entity))}`)
</script>

<template>
  <UButton
    icon="i-lucide-waypoints"
    :label="label"
    color="neutral"
    variant="ghost"
    size="sm"
    :to="to"
    aria-label="Show in graph"
  />
</template>
