<script setup lang="ts">
import type { AutomationRun, AutomationWorkflow } from '#layers/automation/shared/types/automation'
import type { WorkflowTemplate } from '#layers/automation/shared/workflow-templates'
import { runConfidence } from '#layers/automation/shared/automation'

useSeoMeta({ title: 'Automation' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

const tabs = [
  { label: 'Workflows', value: 'workflows' },
  { label: 'Activity', value: 'activity' }
]
const activeTab = computed({
  get: () => route.query.tab === 'activity' ? 'activity' : 'workflows',
  set: value => router.replace({ query: { ...route.query, tab: value } })
})

const { data: workflows, refresh: refreshWorkflows, pending: workflowsPending } = useFetch<AutomationWorkflow[]>('/api/automation/workflows', {
  key: 'automation-workflows',
  default: () => []
})

const { data: runs, refresh: refreshRuns } = useFetch<AutomationRun[]>('/api/automation/runs', {
  key: 'automation-runs',
  query: { limit: 100 },
  default: () => []
})

const lastRunByWorkflow = computed(() => {
  const byWorkflow = new Map<string, AutomationRun>()
  for (const run of runs.value) {
    if (!byWorkflow.has(run.workflow)) {
      byWorkflow.set(run.workflow, run)
    }
  }
  return byWorkflow
})

const OUTCOMES = [
  { label: 'All outcomes', value: '' },
  { label: 'Suggested', value: 'suggested' },
  { label: 'Applied', value: 'applied' },
  { label: 'Failed', value: 'failed' },
  { label: 'Undone', value: 'undone' }
]
const outcomeFilter = computed({
  get: () => typeof route.query.outcome === 'string' ? route.query.outcome : '',
  set: value => router.replace({ query: { ...route.query, outcome: value || undefined } })
})

const DOMAINS = [
  { label: 'All domains', value: '' },
  { label: 'Mail', value: 'mail' },
  { label: 'Documents', value: 'documents' }
]
const domainFilter = computed({
  get: () => typeof route.query.domain === 'string' ? route.query.domain : '',
  set: value => router.replace({ query: { ...route.query, domain: value || undefined } })
})

const filteredRuns = computed(() => runs.value
  .filter(run => !outcomeFilter.value || run.outcome === outcomeFilter.value)
  .filter(run => !domainFilter.value || run.domain === domainFilter.value))

function outcomeColor(outcome: AutomationRun['outcome']) {
  return ({ suggested: 'warning', applied: 'success', failed: 'error', undone: 'neutral', skipped: 'neutral' } as const)[outcome]
}

// --- Enable / mode (optimistic) -------------------------------------------

async function patchWorkflow(workflow: AutomationWorkflow, patch: Partial<AutomationWorkflow>) {
  const previous = workflows.value
  workflows.value = workflows.value.map(entry => entry.id === workflow.id ? { ...entry, ...patch } : entry)
  try {
    await $fetch(`/api/automation/workflows/${workflow.id}`, { method: 'PATCH', body: patch })
  } catch {
    workflows.value = previous
    toast.add({ title: 'Could not save the workflow', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

// --- Reorder (drag) -------------------------------------------------------

const dragIndex = ref<number | null>(null)

async function drop(target: number) {
  const from = dragIndex.value
  dragIndex.value = null
  if (from === null || from === target) {
    return
  }

  const next = [...workflows.value]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved!)
  workflows.value = next

  try {
    workflows.value = await $fetch<AutomationWorkflow[]>('/api/automation/workflows/order', {
      method: 'PUT',
      body: { ids: next.map(workflow => workflow.id) }
    })
  } catch {
    toast.add({ title: 'Could not reorder the workflows', color: 'error', icon: 'i-lucide-circle-alert' })
    await refreshWorkflows()
  }
}

// --- New workflow ---------------------------------------------------------

const creating = ref(false)
const draft = reactive({ name: '', domain: 'mail' as 'mail' | 'documents', service: null as string | null, mode: 'suggest' as 'suggest' | 'auto' })

async function create() {
  try {
    const workflow = await $fetch<AutomationWorkflow>('/api/automation/workflows', { method: 'POST', body: { ...draft, name: draft.name.trim() } })
    creating.value = false
    draft.name = ''
    await router.push(`/automation/${workflow.id}`)
  } catch (failure) {
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not create the workflow', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

// --- Templates ------------------------------------------------------------

const templatesOpen = ref(false)
const instantiating = ref<string | null>(null)

async function instantiate(template: WorkflowTemplate) {
  instantiating.value = template.id
  try {
    const workflow = await $fetch<AutomationWorkflow>('/api/automation/workflows/from-template', {
      method: 'POST',
      body: { template: template.id }
    })
    templatesOpen.value = false
    await router.push(`/automation/${workflow.id}`)
  } catch (failure) {
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not add the template', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    instantiating.value = null
  }
}

function startBlank() {
  templatesOpen.value = false
  creating.value = true
}

// --- Delete (optimistic) --------------------------------------------------

const deleting = ref<AutomationWorkflow | null>(null)
const deleteOpen = computed({
  get: () => deleting.value !== null,
  set: (value) => { if (!value) deleting.value = null }
})

async function remove(workflow: AutomationWorkflow) {
  const previous = workflows.value
  const at = previous.findIndex(entry => entry.id === workflow.id)
  workflows.value = previous.filter(entry => entry.id !== workflow.id)
  deleting.value = null

  try {
    await $fetch(`/api/automation/workflows/${workflow.id}`, { method: 'DELETE' })
    toast.add({ title: `Deleted "${workflow.name}"`, color: 'success', icon: 'i-lucide-trash-2' })
  } catch {
    // Put the row back where it was, not at the end of the list
    const restored = [...workflows.value]
    restored.splice(at < 0 ? restored.length : at, 0, workflow)
    workflows.value = restored
    toast.add({ title: 'Could not delete the workflow', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function rowItems(workflow: AutomationWorkflow) {
  return [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => router.push(`/automation/${workflow.id}`) },
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { deleting.value = workflow } }
  ]
}

// --- Activity actions -----------------------------------------------------

async function runAction(run: AutomationRun, action: 'apply' | 'undo' | 'reject') {
  const previous = runs.value
  const optimistic = action === 'apply' ? 'applied' : action === 'undo' ? 'undone' : 'skipped'
  runs.value = runs.value.map(entry => entry.id === run.id ? { ...entry, outcome: optimistic } : entry)

  try {
    const updated = await $fetch<AutomationRun>(`/api/automation/runs/${run.id}/${action}`, { method: 'POST' })
    runs.value = runs.value.map(entry => entry.id === run.id ? updated : entry)
    toast.add({ title: `${action === 'apply' ? 'Applied' : action === 'undo' ? 'Undone' : 'Rejected'}`, color: 'success', icon: 'i-lucide-check' })
  } catch (failure) {
    runs.value = previous
    toast.add({ title: failure instanceof Error ? failure.message : 'The action failed', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

onMounted(() => {
  refreshRuns()
})
</script>

<template>
  <UDashboardPanel id="automation">
    <UDashboardNavbar title="Automation">
      <template #right>
        <UButton
          label="Templates"
          icon="i-lucide-layout-template"
          color="neutral"
          variant="soft"
          size="sm"
          data-testid="templates-button"
          @click="templatesOpen = true"
        />
        <UButton
          label="New workflow"
          icon="i-lucide-plus"
          size="sm"
          @click="creating = true"
        />
      </template>
      <template #body>
        <UTabs
          v-model="activeTab"
          :items="tabs"
          :content="false"
          size="sm"
        />
      </template>
    </UDashboardNavbar>

    <!-- Workflows -->
    <div v-if="activeTab === 'workflows'" class="flex-1 overflow-auto p-4">
      <div v-if="!workflows.length && !workflowsPending" class="rounded-xl border border-default bg-elevated/20 p-4">
        <WorkflowTemplateGallery
          :busy="instantiating"
          @select="instantiate"
          @blank="startBlank"
        />
      </div>

      <ul v-else class="space-y-2">
        <li
          v-for="(workflow, index) in workflows"
          :key="workflow.id"
          draggable="true"
          class="flex cursor-grab items-center gap-3 rounded-lg border border-default bg-elevated/40 p-3"
          @dragstart="dragIndex = index"
          @dragover.prevent
          @drop="drop(index)"
        >
          <UIcon name="i-lucide-grip-vertical" class="size-4 shrink-0 text-muted" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <NuxtLink :to="`/automation/${workflow.id}`" class="truncate text-sm font-semibold text-highlighted hover:underline">
                {{ workflow.name }}
              </NuxtLink>
              <UBadge size="sm" variant="subtle" :color="workflow.mode === 'auto' ? 'success' : 'warning'">
                {{ workflow.mode }}
              </UBadge>
              <UBadge size="sm" variant="subtle" color="neutral">
                {{ workflow.domain }}
              </UBadge>
            </div>
            <p class="mt-0.5 truncate text-xs text-muted">
              {{ workflow.graph.nodes.length }} nodes
              <template v-if="lastRunByWorkflow.get(workflow.id)">
                · last run {{ new Date(lastRunByWorkflow.get(workflow.id)!.at).toLocaleString() }} ({{ lastRunByWorkflow.get(workflow.id)!.outcome }})
              </template>
            </p>
          </div>
          <USelect
            :model-value="workflow.mode"
            :items="[{ label: 'Suggest', value: 'suggest' }, { label: 'Auto', value: 'auto' }]"
            size="sm"
            class="w-28 shrink-0"
            @update:model-value="value => patchWorkflow(workflow, { mode: value as 'suggest' | 'auto' })"
          />
          <USwitch
            :model-value="workflow.enabled"
            class="shrink-0"
            @update:model-value="value => patchWorkflow(workflow, { enabled: value })"
          />
          <UDropdownMenu :items="rowItems(workflow)">
            <UButton
              icon="i-lucide-ellipsis-vertical"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="Workflow actions"
              data-testid="workflow-actions"
            />
          </UDropdownMenu>
        </li>
      </ul>
    </div>

    <!-- Activity -->
    <div v-else class="flex-1 overflow-auto p-4">
      <div class="mb-3 flex items-center gap-2">
        <USelect
          v-model="outcomeFilter"
          :items="OUTCOMES"
          size="sm"
          class="w-44"
        />
        <USelect
          v-model="domainFilter"
          :items="DOMAINS"
          size="sm"
          class="w-36"
        />
        <span class="text-xs text-muted">{{ filteredRuns.length }} runs</span>
      </div>

      <p v-if="!filteredRuns.length" class="text-sm text-muted">
        Nothing has run yet. Runs appear here once a workflow matches a new item.
      </p>

      <ul class="space-y-2">
        <li v-for="run in filteredRuns" :key="run.id" class="rounded-lg border border-default bg-elevated/40 p-3">
          <div class="flex flex-wrap items-center gap-2">
            <UBadge size="sm" variant="subtle" :color="outcomeColor(run.outcome)">
              {{ run.outcome }}
            </UBadge>
            <span class="text-sm font-medium text-highlighted">{{ run.workflowName }}</span>
            <span class="truncate text-xs text-muted">{{ run.item.title }}</span>
            <span v-if="runConfidence(run.answers) !== undefined" class="text-xs text-muted">
              confidence {{ runConfidence(run.answers)!.toFixed(2) }}
            </span>
            <span class="ml-auto text-xs text-muted">{{ new Date(run.at).toLocaleString() }}</span>
          </div>

          <p v-if="run.actions.length" class="mt-1 text-xs text-muted">
            {{ run.actions.map(action => action.action.type).join(', ') }}
          </p>
          <p v-if="run.error" class="mt-1 text-xs text-error">
            {{ run.error }}
          </p>

          <div v-if="run.outcome === 'suggested' || run.outcome === 'applied'" class="mt-2 flex gap-2">
            <UButton
              v-if="run.outcome === 'suggested'"
              label="Apply"
              icon="i-lucide-check"
              size="xs"
              @click="runAction(run, 'apply')"
            />
            <UButton
              v-if="run.outcome === 'suggested'"
              label="Reject"
              icon="i-lucide-x"
              size="xs"
              color="neutral"
              variant="soft"
              @click="runAction(run, 'reject')"
            />
            <UButton
              v-if="run.outcome === 'applied'"
              label="Undo"
              icon="i-lucide-undo-2"
              size="xs"
              color="warning"
              variant="soft"
              @click="runAction(run, 'undo')"
            />
          </div>
        </li>
      </ul>

      <div class="mt-4">
        <UButton
          label="Export corrections (JSONL)"
          icon="i-lucide-download"
          size="sm"
          color="neutral"
          variant="soft"
          to="/api/automation/corrections"
          external
          download
        />
      </div>
    </div>
  </UDashboardPanel>

  <UModal v-model:open="creating" title="New workflow">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Name" required>
          <UInput
            v-model="draft.name"
            autofocus
            class="w-full"
            placeholder="Sort invoices"
          />
        </UFormField>
        <UFormField label="Domain">
          <USelect v-model="draft.domain" :items="[{ label: 'Mail', value: 'mail' }, { label: 'Documents', value: 'documents' }]" class="w-full" />
        </UFormField>
        <UFormField label="Mode" description="Suggest records what it would do; auto applies it.">
          <USelect v-model="draft.mode" :items="[{ label: 'Suggest', value: 'suggest' }, { label: 'Auto', value: 'auto' }]" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="creating = false"
        />
        <UButton
          label="Create"
          icon="i-lucide-plus"
          :disabled="!draft.name.trim()"
          @click="create"
        />
      </div>
    </template>
  </UModal>

  <UModal v-model:open="templatesOpen" title="Workflow templates">
    <template #body>
      <WorkflowTemplateGallery
        :busy="instantiating"
        @select="instantiate"
        @blank="startBlank"
      />
    </template>
  </UModal>

  <UModal v-model:open="deleteOpen" title="Delete workflow">
    <template #body>
      <p class="text-sm text-muted">
        Delete "{{ deleting?.name }}"? Its history stays in the activity log.
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
          @click="deleting && remove(deleting)"
        />
      </div>
    </template>
  </UModal>
</template>
