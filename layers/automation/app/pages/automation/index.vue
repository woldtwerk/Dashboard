<script setup lang="ts">
import type { AutomationRun, AutomationWorkflow } from '#layers/automation/shared/types/automation'
import type { WorkflowTemplate } from '#layers/automation/shared/workflow-templates'
import { useAutomationRuns } from '#layers/automation/app/composables/useAutomationRuns'
import { formatZoned } from '#layers/core/shared/date-format'

useSeoMeta({ title: 'Automation' })

// `?tab=activity` links predate the section routes
definePageMeta({ middleware: 'automation-tab-redirect' })

const router = useRouter()
const toast = useToast()

// One zone for the listed run times; the rows only format with it
const zone = useTimeZone()

const { data: workflows, refresh: refreshWorkflows, pending: workflowsPending } = useFetch<AutomationWorkflow[]>('/api/automation/workflows', {
  key: 'automation-workflows',
  default: () => []
})

// The feed also says when a workflow last ran
const { runs, refresh: refreshRuns } = useAutomationRuns()

const lastRunByWorkflow = computed(() => {
  const byWorkflow = new Map<string, AutomationRun>()
  for (const run of runs.value) {
    if (!byWorkflow.has(run.workflow)) {
      byWorkflow.set(run.workflow, run)
    }
  }
  return byWorkflow
})

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

onMounted(() => {
  refreshRuns()
})
</script>

<template>
  <UDashboardPanel id="automation">
    <template #header>
      <AutomationHeader>
        <template #actions>
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
      </AutomationHeader>
    </template>

    <template #body>
      <div class="flex-1 overflow-auto p-4">
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
                  · last run {{ formatZoned(lastRunByWorkflow.get(workflow.id)!.at, zone, 'dd MMM yyyy HH:mm') }} ({{ lastRunByWorkflow.get(workflow.id)!.outcome }})
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
    </template>
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

  <UModal v-model:open="templatesOpen" title="Workflow templates" :ui="{ content: 'sm:max-w-5xl' }">
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
