<script setup lang="ts">
import type { FlowNodeData } from '../../utils/workflow-view'
import { nodeSubtitle, nodeTitle } from '../../utils/workflow-view'

defineProps<{ id: string, data: FlowNodeData, selected?: boolean }>()
</script>

<template>
  <WorkflowNodeShell
    :icon="data.node.type === 'trigger' ? 'i-lucide-play' : 'i-lucide-check'"
    :label="nodeTitle(data.node)"
    :subtitle="nodeSubtitle(data.node)"
    :tone="data.tone"
    :selected="selected"
    :highlighted="data.highlighted"
    :errors="data.errors"
    :target="data.node.type !== 'trigger'"
    width="w-60"
  >
    <WorkflowOutputHandles v-if="data.node.type === 'trigger'" :node="data.node" />
  </WorkflowNodeShell>
</template>
