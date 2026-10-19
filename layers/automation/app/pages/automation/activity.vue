<script setup lang="ts">
import type { AutomationRun } from '#layers/automation/shared/types/automation'
import type { AutomationExport, AutomationExportSummary } from '#layers/automation/app/utils/automation-exports'
import { runConfidence } from '#layers/automation/shared/automation'
import { decisionChainLabel } from '#layers/automation/app/utils/workflow-view'
import { automationExports, formatAutomationExportSummary } from '#layers/automation/app/utils/automation-exports'
import { useAutomationRuns } from '#layers/automation/app/composables/useAutomationRuns'
import { formatZoned } from '#layers/core/shared/date-format'

useSeoMeta({ title: 'Automation' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

// One zone for the listed run times; the rows only format with it
const zone = useTimeZone()

const { runs, refresh: refreshRuns } = useAutomationRuns()

// Reka rejects an empty select value, so "no filter" is a sentinel that never reaches the URL
const ALL = 'all'

const OUTCOMES = [
  { label: 'All outcomes', value: ALL },
  { label: 'Needs review', value: 'review' },
  { label: 'Suggested', value: 'suggested' },
  { label: 'Applied', value: 'applied' },
  { label: 'Failed', value: 'failed' },
  { label: 'Undone', value: 'undone' }
]
const outcomeFilter = computed({
  get: () => typeof route.query.outcome === 'string' ? route.query.outcome : ALL,
  set: value => router.replace({ query: { ...route.query, outcome: value === ALL ? undefined : value } })
})

const DOMAINS = [
  { label: 'All domains', value: ALL },
  { label: 'Mail', value: 'mail' },
  { label: 'Documents', value: 'documents' }
]
const domainFilter = computed({
  get: () => typeof route.query.domain === 'string' ? route.query.domain : ALL,
  set: value => router.replace({ query: { ...route.query, domain: value === ALL ? undefined : value } })
})

const filteredRuns = computed(() => runs.value
  .filter(run => outcomeFilter.value === ALL || run.outcome === outcomeFilter.value)
  .filter(run => domainFilter.value === ALL || run.domain === domainFilter.value))

function outcomeColor(outcome: AutomationRun['outcome']) {
  return ({ suggested: 'warning', applied: 'success', failed: 'error', undone: 'neutral', skipped: 'neutral', review: 'info' } as const)[outcome]
}

/** The badge text; `review` reads as an action the user still owes */
function outcomeLabel(outcome: AutomationRun['outcome']) {
  return outcome === 'review' ? 'Needs review' : outcome
}

/** The paused step of a review run: its instructions and the outputs to pick from */
function reviewStep(run: AutomationRun) {
  return run.path.find(step => step.output === 'review')
}

/** The attempt chain of a decision step, e.g. `Laya 0.42 → AI 0.55 → you` */
function decisionChain(run: AutomationRun): string | undefined {
  const step = run.path.find(candidate => candidate.source || candidate.attempts?.length)
  return step ? decisionChainLabel(step) : undefined
}

// --- Run actions ----------------------------------------------------------

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

/** The runs whose review is being answered right now, so their buttons stay disabled */
const answeringRuns = ref(new Set<string>())
/** The output the user clicked per run, so only that button shows its spinner */
const answeringOutputs = ref(new Map<string, string>())

function isAnswering(run: AutomationRun): boolean {
  return answeringRuns.value.has(run.id)
}

function isAnsweringOutput(run: AutomationRun, output: string): boolean {
  return answeringOutputs.value.get(run.id) === output
}

/** Answers a paused review; the run is only replaced once the server has resumed it */
async function answerReview(run: AutomationRun, output: string) {
  answeringRuns.value = new Set(answeringRuns.value).add(run.id)
  answeringOutputs.value = new Map(answeringOutputs.value).set(run.id, output)

  try {
    const updated = await $fetch<AutomationRun>(`/api/automation/runs/${run.id}/answer`, { method: 'POST', body: { output } })
    runs.value = runs.value.map(entry => entry.id === run.id ? updated : entry)
    toast.add({ title: `Answered "${output}"`, color: 'success', icon: 'i-lucide-check' })
  } catch (failure) {
    // The run was never changed optimistically; it is still in review and can be answered again
    toast.add({ title: failure instanceof Error ? failure.message : 'The answer failed', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    const pending = new Set(answeringRuns.value)
    pending.delete(run.id)
    answeringRuns.value = pending
    const outputs = new Map(answeringOutputs.value)
    outputs.delete(run.id)
    answeringOutputs.value = outputs
  }
}

// --- Registered exports ---------------------------------------------------

/**
 * Downloads other layers registered (e.g. Laya training data). Read once at setup:
 * client plugins register before the page renders, and the registry does not change.
 */
const exportEntries = automationExports()
const exportSummaries = ref<Record<string, string>>({})

/** Fetches each export's summary when the menu opens, never on page load */
async function openExportMenu(open: boolean) {
  if (!open) {
    return
  }

  await Promise.all(exportEntries.map(async (entry) => {
    if (!entry.summary || exportSummaries.value[entry.id]) {
      return
    }
    try {
      const summary = await $fetch<AutomationExportSummary>(entry.summary)
      exportSummaries.value = { ...exportSummaries.value, [entry.id]: formatAutomationExportSummary(summary) }
    } catch {
      // The summary is decoration; a failed fetch must not block the download
    }
  }))
}

const exportItems = computed(() => exportEntries.map(entry => ({
  label: entry.label,
  icon: entry.icon,
  description: exportSummaries.value[entry.id],
  onSelect: () => downloadExport(entry)
})))

function downloadExport(entry: AutomationExport) {
  window.location.assign(entry.to)
}

onMounted(() => {
  refreshRuns()
})
</script>

<template>
  <UDashboardPanel id="automation">
    <template #header>
      <AutomationHeader />
    </template>

    <template #body>
      <div class="flex-1 overflow-auto p-4">
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
                {{ outcomeLabel(run.outcome) }}
              </UBadge>
              <span class="text-sm font-medium text-highlighted">{{ run.workflowName }}</span>
              <span class="truncate text-xs text-muted">{{ run.item.title }}</span>
              <span v-if="runConfidence(run.answers) !== undefined" class="text-xs text-muted">
                confidence {{ runConfidence(run.answers)!.toFixed(2) }}
              </span>
              <span class="ml-auto text-xs text-muted">{{ formatZoned(run.at, zone, 'dd MMM yyyy HH:mm') }}</span>
            </div>

            <p v-if="decisionChain(run)" class="mt-1 text-xs text-muted">
              {{ decisionChain(run) }}
            </p>
            <p v-if="run.actions.length" class="mt-1 text-xs text-muted">
              {{ run.actions.map(action => action.action.type).join(', ') }}
            </p>
            <p v-if="run.error" class="mt-1 text-xs text-error">
              {{ run.error }}
            </p>

            <div v-if="run.outcome === 'review' && reviewStep(run)?.review" class="mt-2 space-y-2">
              <p class="text-xs text-highlighted">
                {{ reviewStep(run)!.review!.instructions }}
              </p>
              <div class="flex flex-wrap gap-2">
                <UButton
                  v-for="output in reviewStep(run)!.review!.outputs"
                  :key="output"
                  :label="output"
                  :title="reviewStep(run)!.review!.options?.[output]"
                  size="xs"
                  :disabled="isAnswering(run)"
                  :loading="isAnsweringOutput(run, output)"
                  @click="answerReview(run, output)"
                />
              </div>
              <p v-if="reviewStep(run)!.attempts?.length" class="text-[11px] text-muted">
                {{ decisionChainLabel(reviewStep(run)!) }}
              </p>
            </div>

            <div v-if="run.outcome === 'suggested' || run.outcome === 'applied' || run.outcome === 'review'" class="mt-2 flex gap-2">
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
                v-if="run.outcome === 'review'"
                label="Dismiss"
                icon="i-lucide-x"
                size="xs"
                color="neutral"
                variant="soft"
                :disabled="isAnswering(run)"
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

        <div class="mt-4 flex flex-wrap items-center gap-2">
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
          <UDropdownMenu
            v-if="exportEntries.length"
            :items="exportItems"
            :ui="{ content: 'min-w-64' }"
            @update:open="openExportMenu"
          >
            <UButton
              label="More exports"
              icon="i-lucide-database"
              trailing-icon="i-lucide-chevron-down"
              size="sm"
              color="neutral"
              variant="soft"
            />
          </UDropdownMenu>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
