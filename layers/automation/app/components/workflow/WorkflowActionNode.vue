<script setup lang="ts">
import type { FlowNodeData } from '../../utils/workflow-view'
import { actionIcon, nodeSubtitle, nodeTitle } from '../../utils/workflow-view'

const props = defineProps<{ id: string, data: FlowNodeData, selected?: boolean }>()

const icon = computed(() => props.data.node.type === 'action' ? actionIcon(props.data.node.data.action) : 'i-lucide-zap')
</script>

<template>
  <WorkflowNodeShell
    :icon="icon"
    :label="nodeTitle(data.node)"
    :subtitle="nodeSubtitle(data.node)"
    :tone="data.tone"
    :selected="selected"
    :highlighted="data.highlighted"
    :errors="data.errors"
  >
    <WorkflowOutputHandles :node="data.node" />
  </WorkflowNodeShell>
</template>
