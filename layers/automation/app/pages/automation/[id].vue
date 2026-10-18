<script setup lang="ts">
import type { AutomationWorkflow, WorkflowGraph, WorkflowNode, WorkflowNodeType } from '#layers/automation/shared/types/automation'
import { createDefaultGraph, validateWorkflow } from '#layers/automation/shared/workflow'
import {
  addWorkflowNode,
  canRedoWorkflow,
  canUndoWorkflow,
  commitWorkflow,
  connectWorkflowNodes,
  createWorkflowHistory,
  moveWorkflowNode,
  nextNodeId,
  pruneWorkflowEdges,
  redoWorkflow,
  removeWorkflowEdge,
  removeWorkflowNode,
  undoWorkflow,
  updateWorkflowNode
} from '#layers/automation/app/utils/workflow-edit'
import type { WorkflowConnection, WorkflowHistory } from '#layers/automation/app/utils/workflow-edit'

definePageMeta({
  key: route => `/automation/${route.params.id}`
})

const route = useRoute()
const id = route.params.id as string
const toast = useToast()

const { data: workflow } = await useFetch<AutomationWorkflow>(`/api/automation/workflows/${id}`)

const name = ref(workflow.value?.name ?? '')
const domain = ref(workflow.value?.domain ?? 'mail')
const service = ref(workflow.value?.service ?? null)
const enabled = ref(workflow.value?.enabled ?? true)
const mode = ref(workflow.value?.mode ?? 'suggest')

const { data: services } = useServices()
const serviceItems = computed(() => [
  { label: 'All services', value: '' },
  ...services.value.filter(entry => entry.domain === domain.value).map(entry => ({ label: entry.name, value: entry.id }))
])
const serviceSelection = computed({
  get: () => service.value ?? '',
  set: (value) => { service.value = value || null }
})

const history = ref<WorkflowHistory>(createWorkflowHistory(workflow.value?.graph ?? createDefaultGraph('mail')))
const graph = computed(() => history.value.present)

const errors = computed(() => validateWorkflow(graph.value, domain.value))
const valid = computed(() => errors.value.length === 0)

const selectedId = ref<string | null>(null)
const selectedEdgeId = ref<string | null>(null)
const selectedNode = computed(() => graph.value.nodes.find(node => node.id === selectedId.value) ?? null)
const selectedEdge = computed(() => graph.value.edges.find(edge => edge.id === selectedEdgeId.value) ?? null)

const highlightedNodes = ref<Set<string>>(new Set())
const highlightedEdges = ref<Set<string>>(new Set())
const previewOpen = ref(false)

const tone = computed(() => domain.value === 'mail' ? 'primary' as const : 'info' as const)

function payload() {
  return { name: name.value, domain: domain.value, service: service.value, enabled: enabled.value, mode: mode.value, graph: graph.value }
}

const saved = ref(JSON.stringify(payload()))
const dirty = computed(() => JSON.stringify(payload()) !== saved.value)

function commitGraph(next: WorkflowGraph) {
  history.value = commitWorkflow(history.value, next)
}

function undo() {
  history.value = undoWorkflow(history.value)
}

function redo() {
  history.value = redoWorkflow(history.value)
}

function defaultPosition() {
  const index = graph.value.nodes.length
  return { x: 80 + (index % 3) * 240, y: 160 + Math.floor(index / 3) * 150 }
}

function domainDefaultAction() {
  return domain.value === 'mail' ? { type: 'star' as const } : { type: 'add-tag' as const, tag: 1 }
}

function createNode(type: WorkflowNodeType, position: { x: number, y: number }): WorkflowNode {
  const nodeId = nextNodeId(graph.value, type)
  switch (type) {
    case 'condition':
      return { id: nodeId, type, position, data: { conditions: { combine: 'all', conditions: [{ field: 'subject', op: 'contains', value: '' }] } } }
    case 'decision':
      return { id: nodeId, type, position, data: { question: 'yesno', instructions: 'Is this important?', thresholds: { yes: 0.85, no: 0.85 } } }
    case 'action':
      return { id: nodeId, type, position, data: { action: domainDefaultAction() } }
    case 'end':
      return { id: nodeId, type, position, data: {} }
    default:
      return { id: nodeId, type: 'trigger', position, data: { kind: 'new-item', mailbox: 'INBOX' } }
  }
}

function addNode(type: WorkflowNodeType, position?: { x: number, y: number }) {
  const node = createNode(type, position ?? defaultPosition())
  commitGraph(addWorkflowNode(graph.value, node))
  selectedId.value = node.id
  selectedEdgeId.value = null
}

function updateNode(node: WorkflowNode) {
  commitGraph(pruneWorkflowEdges(updateWorkflowNode(graph.value, node.id, node)))
}

function removeNode(nodeId: string) {
  commitGraph(removeWorkflowNode(graph.value, nodeId))
  if (selectedId.value === nodeId) {
    selectedId.value = null
  }
}

function moveNode(nodeId: string, position: { x: number, y: number }) {
  commitGraph(moveWorkflowNode(graph.value, nodeId, position))
}

function connect(connection: WorkflowConnection) {
  const next = pruneWorkflowEdges(connectWorkflowNodes(graph.value, connection))
  commitGraph(next)
}

function removeEdge(edgeId: string) {
  commitGraph(removeWorkflowEdge(graph.value, edgeId))
  selectedEdgeId.value = null
}

async function save() {
  const body = payload()
  try {
    const updated = await $fetch<AutomationWorkflow>(`/api/automation/workflows/${id}`, { method: 'PATCH', body })
    saved.value = JSON.stringify({ name: updated.name, domain: updated.domain, service: updated.service, enabled: updated.enabled, mode: updated.mode, graph: updated.graph })
    toast.add({ title: 'Workflow saved', color: 'success', icon: 'i-lucide-check' })
  } catch (failure) {
    // Roll back to the last saved state, so the editor never shows something the server rejected
    const snapshot = JSON.parse(saved.value) as ReturnType<typeof payload>
    name.value = snapshot.name
    domain.value = snapshot.domain
    service.value = snapshot.service
    enabled.value = snapshot.enabled
    mode.value = snapshot.mode
    history.value = createWorkflowHistory(snapshot.graph)
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not save', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function highlight(nodeIds: string[], edgeIds: string[]) {
  highlightedNodes.value = new Set(nodeIds)
  highlightedEdges.value = new Set(edgeIds)
}

function focusNode(nodeId: string | null) {
  selectedId.value = nodeId
  selectedEdgeId.value = null
}
</script>

<template>
  <UDashboardPanel id="automation-editor">
    <UDashboardNavbar :title="name || 'Workflow'">
      <template #leading>
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/automation"
          aria-label="Back to automation"
        />
      </template>
      <template #right>
        <UButton
          icon="i-lucide-undo-2"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="!canUndoWorkflow(history)"
          aria-label="Undo"
          @click="undo"
        />
        <UButton
          icon="i-lucide-redo-2"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="!canRedoWorkflow(history)"
          aria-label="Redo"
          @click="redo"
        />
        <UButton
          :label="previewOpen ? 'Hide preview' : 'Preview'"
          icon="i-lucide-eye"
          color="neutral"
          variant="soft"
          size="sm"
          @click="previewOpen = !previewOpen"
        />
        <UButton
          label="Save"
          icon="i-lucide-save"
          size="sm"
          :disabled="!valid || !dirty"
          @click="save"
        />
      </template>

      <template #body>
        <div class="flex flex-wrap items-center gap-2">
          <UInput
            v-model="name"
            size="sm"
            class="w-56"
            placeholder="Workflow name"
          />
          <USelect
            v-model="mode"
            :items="[{ label: 'Suggest', value: 'suggest' }, { label: 'Auto', value: 'auto' }]"
            size="sm"
            class="w-28"
          />
          <USelect
            v-model="serviceSelection"
            :items="serviceItems"
            size="sm"
            class="w-40"
          />
          <UBadge size="sm" variant="subtle" color="neutral">
            {{ domain }}
          </UBadge>
          <USwitch v-model="enabled" label="Enabled" />
          <UBadge
            v-if="valid"
            size="sm"
            variant="subtle"
            color="success"
          >
            valid
          </UBadge>
          <UBadge
            v-else
            size="sm"
            variant="subtle"
            color="error"
          >
            {{ errors.length }} issue{{ errors.length === 1 ? '' : 's' }}
          </UBadge>
        </div>
      </template>
    </UDashboardNavbar>

    <div class="flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="border-b border-default p-2">
          <WorkflowPalette :domain="domain" @add="addNode" />
        </div>
        <div class="min-h-0 flex-1">
          <WorkflowCanvas
            :graph="graph"
            :errors="errors"
            :highlighted-nodes="highlightedNodes"
            :highlighted-edges="highlightedEdges"
            :selected-id="selectedId"
            :tone="tone"
            @select="focusNode"
            @select-edge="edgeId => { selectedEdgeId = edgeId; selectedId = null }"
            @move="moveNode"
            @connect="connect"
            @add-node="addNode"
          />
        </div>
        <div v-if="previewOpen" class="h-96 border-t border-default">
          <WorkflowPreviewPanel
            :graph="graph"
            :domain="domain"
            :service="service"
            @highlight="highlight"
            @focus="focusNode"
          />
        </div>
      </div>

      <aside class="hidden w-80 shrink-0 border-l border-default lg:block">
        <WorkflowInspector
          :node="selectedNode"
          :edge="selectedEdge"
          :domain="domain"
          :service="service"
          :errors="errors"
          @update="updateNode"
          @remove="removeNode"
          @remove-edge="removeEdge"
        />
      </aside>
    </div>
  </UDashboardPanel>
</template>
