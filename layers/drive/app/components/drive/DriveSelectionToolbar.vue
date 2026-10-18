<script setup lang="ts">
import type { DriveSelectionAction } from '../../utils/selection-action'

defineProps<{
  count: number
  actions: DriveSelectionAction[]
}>()

const emit = defineEmits<{
  action: [key: string]
  clear: []
}>()
</script>

<template>
  <div class="flex min-w-0 flex-1 items-center justify-between gap-1.5">
    <div class="flex min-w-0 items-center gap-1.5">
      <span class="truncate text-sm font-medium">{{ count }} selected</span>

      <UTooltip text="Clear selection">
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Clear selection"
          @click="emit('clear')"
        />
      </UTooltip>
    </div>

    <div class="flex items-center gap-1.5">
      <UTooltip
        v-for="action in actions"
        :key="action.key"
        :text="action.label"
      >
        <UButton
          :icon="action.icon"
          :color="action.color ?? 'neutral'"
          variant="ghost"
          size="sm"
          :aria-label="action.label"
          @click="emit('action', action.key)"
        />
      </UTooltip>
    </div>
  </div>
</template>
