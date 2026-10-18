<script setup lang="ts">
import { VisGraph, VisSingleContainer, VisTooltip } from '@unovis/vue'
import { Graph } from '@unovis/ts'
import type { EntityGraph, GraphNode } from '#layers/core/shared/types/entities'
import type { GraphCanvasLink, GraphCanvasNode } from '../utils/graph'
import { entityTypeLabel, graphData, graphLegend } from '../utils/graph'

const props = withDefaults(defineProps<{
  graph: EntityGraph
  selected?: string | null
  height?: number
}>(), {
  selected: null,
  height: 480
})

const emit = defineEmits<{
  select: [node: GraphNode]
  expand: [node: GraphNode]
}>()

const data = computed(() => graphData(props.graph))
const legend = computed(() => graphLegend(props.graph))
const graphRef = useTemplateRef<{ component?: { fitView?: () => void } }>('graphRef')

const events = {
  [Graph.selectors.node]: {
    click: (node: GraphNode) => emit('select', node),
    dblclick: (node: GraphNode) => emit('expand', node)
  }
}

// A frontier node's neighbours are not loaded yet; the dashed outline says so
const attributes = {
  [Graph.selectors.node]: {
    'stroke-dasharray': (node: { frontier: boolean }) => node.frontier ? '4 3' : ''
  }
}

const triggers = {
  [Graph.selectors.node]: (node: { label: string, type: GraphNode['type'] }) =>
    `<div class="font-medium">${node.label}</div><div class="text-xs opacity-70">${entityTypeLabel(node.type)}</div>`
}

function fit() {
  graphRef.value?.component?.fitView?.()
}

defineExpose({ fit })
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li v-for="entry in legend" :key="entry.type" class="flex items-center gap-1.5">
          <UIcon :name="entry.icon" class="size-3.5" />
          {{ entry.label }}
        </li>
      </ul>
      <UButton
        label="Fit"
        icon="i-lucide-maximize"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="fit"
      />
    </div>

    <VisSingleContainer
      :data="data"
      :height="height"
      :aria-label="'Entity graph'"
    >
      <VisGraph
        ref="graphRef"
        layout-type="force"
        :node-fill="(node: GraphCanvasNode) => node.fill"
        :node-shape="(node: GraphCanvasNode) => node.shape"
        :node-icon="(node: GraphCanvasNode) => node.icon"
        :node-label="(node: GraphCanvasNode) => node.label"
        :node-label-trim-length="18"
        :node-size="32"
        :node-stroke-width="2"
        :link-width="(link: GraphCanvasLink) => link.width"
        :link-style="(link: GraphCanvasLink) => link.style"
        :selected-node-id="selected ?? undefined"
        :events="events"
        :attributes="attributes"
      />
      <VisTooltip :triggers="triggers" />
    </VisSingleContainer>
  </div>
</template>
