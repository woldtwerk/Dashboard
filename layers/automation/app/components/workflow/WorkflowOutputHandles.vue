<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import type { WorkflowNode } from '../../../shared/types/automation'
import { outputLabel } from '../../utils/workflow-view'
import { nodeOutputs } from '../../../shared/workflow'

const props = defineProps<{ node: WorkflowNode }>()

const outputs = computed(() => nodeOutputs(props.node).map(key => ({ key, label: outputLabel(props.node, key) })))

function top(index: number, total: number): string {
  return `${((index + 1) / (total + 1)) * 100}%`
}
</script>

<template>
  <template v-for="(output, index) in outputs" :key="output.key">
    <span
      class="absolute right-4 -translate-y-1/2 text-[10px] font-medium text-muted"
      :style="{ top: top(index, outputs.length) }"
    >
      {{ output.label }}
    </span>
    <Handle
      :id="output.key"
      type="source"
      :position="Position.Right"
      :style="{ top: top(index, outputs.length) }"
      class="!size-2.5 !border-2 !border-default !bg-elevated"
    />
  </template>
</template>
