<script setup lang="ts">
import type { AutomationDomain, AutomationWorkflow, WorkflowGraph, WorkflowNode, WorkflowNodeType } from '#layers/automation/shared/types/automation'
import { createDefaultGraph, validateWorkflow } from '#layers/automation/shared/workflow'
import { DRAFT_ACTION_ID, draftFromItem } from '#layers/automation/shared/workflow-draft'
import type { DraftItemContext } from '#layers/automation/shared/workflow-draft'
import { availableVariables } from '#layers/automation/app/utils/workflow-view'
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
const router = useRouter()
const id = route.params.id as string
/** `/automation/new` is the same builder, fed by a draft item instead of an id */
const isDraft = id === 'new'
const toast = useToast()

const workflow = ref<AutomationWorkflow | null>(null)
if (!isDraft) {
  const { data } = await useFetch<AutomationWorkflow>(`/api/automation/workflows/${id}`)
  workflow.value = data.value ?? null
}

// "Create workflow…" only carries the item's key; read it back, then let the
// pure `draftFromItem` build the graph the builder opens with. Nothing is stored
// until Save.
const draftRef = isDraft && typeof route.query.from === 'string' ? route.query.from : ''
const draftContext = ref<DraftItemContext | null>(null)
if (draftRef) {
  const { data } = await useFetch<DraftItemContext>('/api/automation/item', { query: { ref: draftRef } })
  draftContext.value = data.value ?? null
}
const draft = draftContext.value ? draftFromItem(draftContext.value.domain, draftContext.value.item) : null

const name = ref(workflow.value?.name ?? draft?.name ?? '')
const domain = ref<AutomationDomain>(workflow.value?.domain ?? draftContext.value?.domain ?? 'mail')
const service = ref(workflow.value?.service ?? (typeof route.query.service === 'string' ? route.query.service : null))
// A draft is stored disabled and in suggest mode; an existing workflow keeps its own state
const enabled = ref(workflow.value?.enabled ?? !isDraft)
const mode = ref(workflow.value?.mode ?? 'suggest')

const { data: services } = useServices()

// Reka rejects an empty select value, so "no service" is a sentinel that maps to `null`
const ALL_SERVICES = 'all'
const serviceItems = computed(() => [
  { label: 'All services', value: ALL_SERVICES },
  ...services.value.filter(entry => entry.domain === domain.value).map(entry => ({ label: entry.name, value: entry.id }))
])
const serviceSelection = computed({
  get: () => service.value ?? ALL_SERVICES,
  set: (value) => { service.value = value === ALL_SERVICES ? null : value }
})

const history = ref<WorkflowHistory>(createWorkflowHistory(workflow.value?.graph ?? draft?.graph ?? createDefaultGraph('mail')))
const graph = computed(() => history.value.present)

const errors = computed(() => validateWorkflow(graph.value, domain.value))
const valid = computed(() => errors.value.length === 0)

// The draft opens with the inspector on its placeholder action, ready to be set
const selectedId = ref<string | null>(draft ? DRAFT_ACTION_ID : null)
const selectedEdgeId = ref<string | null>(null)
const selectedNode = computed(() => graph.value.nodes.find(node => node.id === selectedId.value) ?? null)
const selectedEdge = computed(() => graph.value.edges.find(edge => edge.id === selectedEdgeId.value) ?? null)

const highlightedNodes = ref<Set<string>>(new Set())
const highlightedEdges = ref<Set<string>>(new Set())
const previewOpen = ref(!!draftRef)

const tone = computed(() => domain.value === 'mail' ? 'primary' as const : 'info' as const)

function payload() {
  return { name: name.value, domain: domain.value, service: service.value, enabled: enabled.value, mode: mode.value, graph: graph.value }
}

const saved = ref(isDraft ? '' : JSON.stringify(payload()))
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

  // A draft does not exist yet: create it (disabled, suggest) and open the real builder
  if (isDraft) {
    try {
      const created = await $fetch<AutomationWorkflow>('/api/automation/workflows', { method: 'POST', body })
      toast.add({ title: 'Workflow saved', color: 'success', icon: 'i-lucide-check' })
      await router.replace(`/automation/${created.id}`)
    } catch (failure) {
      toast.add({ title: failure instanceof Error ? failure.message : 'Could not save', color: 'error', icon: 'i-lucide-circle-alert' })
    }
    return
  }

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

const deleteOpen = ref(false)

async function removeWorkflow() {
  deleteOpen.value = false
  try {
    await $fetch(`/api/automation/workflows/${id}`, { method: 'DELETE' })
    toast.add({ title: 'Workflow deleted', color: 'success', icon: 'i-lucide-trash-2' })
    await router.push('/automation')
  } catch (failure) {
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not delete the workflow', color: 'error', icon: 'i-lucide-circle-alert' })
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
    <template #header>
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
            v-if="!isDraft"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="sm"
            aria-label="Delete workflow"
            data-testid="delete-workflow"
            @click="deleteOpen = true"
          />
          <UButton
            label="Save"
            icon="i-lucide-save"
            size="sm"
            :disabled="!valid || !dirty"
            @click="save"
          />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
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
      </UDashboardToolbar>
    </template>

    <template #body>
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
              :initial-ref="draftRef || undefined"
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
            :variables="availableVariables(graph)"
            @update="updateNode"
            @remove="removeNode"
            @remove-edge="removeEdge"
          />
        </aside>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-if="!isDraft" v-model:open="deleteOpen" title="Delete workflow">
    <template #body>
      <p class="text-sm text-muted">
        Delete "{{ name || 'this workflow' }}"? Its history stays in the activity log.
      </p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="deleteOpen = false"
        />
        <UButton
          label="Delete"
          icon="i-lucide-trash-2"
          color="error"
          data-testid="confirm-delete"
          @click="removeWorkflow"
        />
      </div>
    </template>
  </UModal>
</template>
