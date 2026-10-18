<script setup lang="ts">
import { VueFlow, useVueFlow } from '@vue-flow/core'
import type { Connection, NodeTypesObject } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import type { WorkflowGraph, WorkflowNodeType } from '../../../shared/types/automation'
import type { WorkflowValidationError } from '../../../shared/workflow'
import { toFlowEdges, toFlowNodes } from '../../utils/workflow-view'
import WorkflowTriggerNode from './WorkflowTriggerNode.vue'
import WorkflowConditionNode from './WorkflowConditionNode.vue'
import WorkflowDecisionNode from './WorkflowDecisionNode.vue'
import WorkflowActionNode from './WorkflowActionNode.vue'
import WorkflowEndNode from './WorkflowEndNode.vue'

const props = defineProps<{
  graph: WorkflowGraph
  errors: WorkflowValidationError[]
  highlightedNodes: Set<string>
  highlightedEdges: Set<string>
  selectedId: string | null
  tone: 'primary' | 'info'
}>()

const emit = defineEmits<{
  select: [nodeId: string | null]
  selectEdge: [edgeId: string | null]
  move: [nodeId: string, position: { x: number, y: number }]
  connect: [connection: Connection]
  addNode: [type: WorkflowNodeType, position: { x: number, y: number }]
}>()

const canvasId = 'automation-canvas'
const { screenToFlowCoordinate } = useVueFlow(canvasId)

const nodes = ref(toFlowNodes(props.graph, props.errors, props.highlightedNodes, props.tone))
const edges = ref(toFlowEdges(props.graph, props.highlightedEdges))

watch(
  () => [props.graph, props.errors, props.highlightedNodes, props.highlightedEdges, props.tone] as const,
  () => {
    nodes.value = toFlowNodes(props.graph, props.errors, props.highlightedNodes, props.tone)
    edges.value = toFlowEdges(props.graph, props.highlightedEdges)
  },
  { deep: true }
)

// Kept raw so Vue does not make the components themselves reactive. Our node
// components declare only the props they use, so the object is cast to Vue Flow's
// wider node-component shape.
const nodeTypes = {
  trigger: markRaw(WorkflowTriggerNode),
  condition: markRaw(WorkflowConditionNode),
  decision: markRaw(WorkflowDecisionNode),
  action: markRaw(WorkflowActionNode),
  end: markRaw(WorkflowEndNode)
} as unknown as NodeTypesObject

function onDrop(event: DragEvent) {
  const type = event.dataTransfer?.getData('application/x-workflow-node') as WorkflowNodeType | undefined
  if (!type) {
    return
  }
  emit('addNode', type, screenToFlowCoordinate({ x: event.clientX, y: event.clientY }))
}
</script>

<template>
  <div class="relative h-full w-full" @drop.prevent="onDrop" @dragover.prevent>
    <VueFlow
      :id="canvasId"
      v-model:nodes="nodes"
      v-model:edges="edges"
      :node-types="nodeTypes"
      :delete-key-code="null"
      :min-zoom="0.2"
      :max-zoom="1.6"
      :default-viewport="{ zoom: 0.9 }"
      fit-view-on-init
      @connect="connection => emit('connect', connection)"
      @node-drag-stop="({ node }) => emit('move', node.id, node.position)"
      @node-click="({ node }) => emit('select', node.id)"
      @edge-click="({ edge }) => emit('selectEdge', edge.id)"
      @pane-click="emit('select', null)"
    >
      <Background :gap="24" pattern-color="currentColor" class="text-default/40" />
      <Controls />
      <MiniMap pannable zoomable />
    </VueFlow>
  </div>
</template>
