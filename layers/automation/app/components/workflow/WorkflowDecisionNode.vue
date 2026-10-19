<script setup lang="ts">
import type { FlowNodeData } from '../../utils/workflow-view'
import { nodeSubtitle, nodeTitle } from '../../utils/workflow-view'
import { fallbackChainLabel } from '../../utils/decision-fallbacks'

const props = defineProps<{ id: string, data: FlowNodeData, selected?: boolean }>()

/** The fallback chain as a short line, e.g. `AI → Human`; empty without fallbacks */
const chain = computed(() => fallbackChainLabel(props.data.node.type === 'decision' ? props.data.node.data.fallbacks : undefined))
</script>

<template>
  <WorkflowNodeShell
    icon="i-lucide-sparkles"
    :label="nodeTitle(data.node)"
    :subtitle="nodeSubtitle(data.node)"
    :tone="data.tone"
    :selected="selected"
    :highlighted="data.highlighted"
    :errors="data.errors"
    width="w-72"
  >
    <p v-if="chain" class="flex items-center gap-1 text-[11px] text-muted">
      <UIcon name="i-lucide-git-branch" class="size-3" />
      {{ chain }}
    </p>
    <WorkflowOutputHandles :node="data.node" />
  </WorkflowNodeShell>
</template>
