<script setup lang="ts">
import type { WorkflowNodeType } from '../../../shared/types/automation'

defineProps<{ domain: 'mail' | 'documents' }>()

const emit = defineEmits<{ add: [type: WorkflowNodeType] }>()

const items: Array<{ type: WorkflowNodeType, label: string, icon: string, hint: string }> = [
  { type: 'condition', label: 'Condition', icon: 'i-lucide-filter', hint: 'Branch on fields' },
  { type: 'decision', label: 'Ask Laya', icon: 'i-lucide-sparkles', hint: 'AI decision' },
  { type: 'action', label: 'Action', icon: 'i-lucide-zap', hint: 'Change the item' },
  { type: 'end', label: 'End', icon: 'i-lucide-square', hint: 'Stop the path' }
]

function dragStart(event: DragEvent, type: WorkflowNodeType) {
  event.dataTransfer?.setData('application/x-workflow-node', type)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-for="item in items"
      :key="item.type"
      type="button"
      draggable="true"
      class="flex cursor-grab items-center gap-2 rounded-md border border-default bg-elevated/60 px-2.5 py-1.5 text-xs font-medium text-default transition hover:border-primary/50 hover:bg-elevated"
      :title="`${item.hint} — drag onto the canvas or click to add`"
      @dragstart="dragStart($event, item.type)"
      @click="emit('add', item.type)"
    >
      <UIcon :name="item.icon" class="size-3.5 text-muted" />
      {{ item.label }}
    </button>
  </div>
</template>
