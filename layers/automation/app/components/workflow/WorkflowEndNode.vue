<script setup lang="ts">
import type { FlowNodeData } from '../../utils/workflow-view'
import { nodeSubtitle, nodeTitle } from '../../utils/workflow-view'

defineProps<{ id: string, data: FlowNodeData, selected?: boolean }>()
</script>

<template>
  <WorkflowNodeShell
    icon="i-lucide-square"
    :label="nodeTitle(data.node)"
    :subtitle="nodeSubtitle(data.node)"
    :tone="data.tone"
    :selected="selected"
    :highlighted="data.highlighted"
    :errors="data.errors"
    width="w-40"
  />
</template>
