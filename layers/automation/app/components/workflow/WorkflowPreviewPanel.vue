<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import type { SearchHit, SearchResults } from '#layers/core/shared/types/search'
import type { AutomationDomain, DecisionAnswer, WorkflowGraph, WorkflowPathStep, WorkflowPreviewEvent, WorkflowPreviewItem, WorkflowPreviewSource } from '../../../shared/types/automation'
import { pathEdges } from '../../utils/workflow-edit'
import { decisionChainLabel, nodeTitle } from '../../utils/workflow-view'

const props = defineProps<{
  graph: WorkflowGraph
  domain: AutomationDomain
  service: string | null
  /** An item to preview as soon as the panel opens, e.g. the draft's source item */
  initialRef?: string
}>()

const emit = defineEmits<{
  highlight: [nodeIds: string[], edgeIds: string[]]
  focus: [nodeId: string | null]
}>()

const route = useRoute()
const router = useRouter()

const tabs = [
  { label: 'Last 50', value: 'recent' },
  { label: 'Pick an item', value: 'item' },
  { label: 'Free text', value: 'text' }
]

const activeTab = computed({
  get: () => typeof route.query.preview === 'string' && tabs.some(tab => tab.value === route.query.preview)
    ? route.query.preview
    : props.initialRef ? 'item' : 'recent',
  set: value => router.replace({ query: { ...route.query, preview: value } })
})

const loading = ref(false)
const error = ref('')
const aiUnavailable = ref(false)
/** What the server is doing right now, e.g. which decision node it asks */
const status = ref('')
/** Every item of the running or last preview, in order; `done` fills in as walks end */
const started = ref<Array<{ ref: string, title: string }>>([])
const done = ref<Record<number, WorkflowPreviewItem>>({})
const selectedIndex = ref<number | null>(null)

const decisionNodes = computed(() => props.graph.nodes.filter(node => node.type === 'decision'))
const doneCount = computed(() => Object.keys(done.value).length)
const textItem = computed(() => done.value[0])
/** One row per item of the preview; `item` is unset while its walk still runs */
const rows = computed(() => started.value.map((entry, index) => ({ entry, item: done.value[index] })))

/** A busy lock is retried this long: a stopped preview finishes its current decision call first */
const BUSY_RETRY_MS = 2_000
const BUSY_WAIT_MS = 120_000

let running: AbortController | undefined

function stop() {
  running?.abort()
  running = undefined
  loading.value = false
  status.value = ''
}

onBeforeUnmount(stop)

function handle(line: WorkflowPreviewEvent): 'busy' | undefined {
  switch (line.type) {
    case 'loading':
      status.value = 'Loading items…'
      break
    case 'started':
      started.value = line.items
      status.value = ''
      break
    case 'deciding': {
      const node = props.graph.nodes.find(candidate => candidate.id === line.nodeId)
      status.value = `Asking ${node ? nodeTitle(node) : line.nodeId} about ${line.items} item${line.items === 1 ? '' : 's'}…`
      break
    }
    case 'item':
      done.value = { ...done.value, [line.index]: line.item }
      break
    case 'done':
      aiUnavailable.value = line.aiUnavailable
      break
    case 'error':
      if (line.busy) {
        return 'busy'
      }
      error.value = line.message
  }
}

/** Streams one preview; resolves 'busy' when another preview still holds the lock */
async function stream(source: WorkflowPreviewSource, signal: AbortSignal): Promise<'busy' | undefined> {
  const response = await fetch('/api/automation/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph: props.graph, domain: props.domain, service: props.service, source }),
    signal
  })
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => undefined) as { statusText?: string, message?: string } | undefined
    throw new Error(data?.statusText || data?.message || `The preview failed (${response.status})`)
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done: ended } = await reader.read()
    if (ended) {
      return
    }
    buffer += value
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line && handle(JSON.parse(line) as WorkflowPreviewEvent) === 'busy') {
        return 'busy'
      }
      newline = buffer.indexOf('\n')
    }
  }
}

/**
 * Starts a preview, stopping one that is still running: picking an item while the
 * last 50 run must not be ignored. The server stops the old walk before its next
 * decision call; until then its lock is busy and the new preview waits for it.
 */
async function request(source: WorkflowPreviewSource) {
  stop()
  const controller = new AbortController()
  running = controller

  loading.value = true
  error.value = ''
  aiUnavailable.value = false
  status.value = 'Starting…'
  started.value = []
  done.value = {}
  selectedIndex.value = null
  emit('highlight', [], [])

  try {
    const waitUntil = Date.now() + BUSY_WAIT_MS
    while (await stream(source, controller.signal) === 'busy') {
      if (Date.now() > waitUntil) {
        error.value = 'A preview is still running; try again in a moment'
        break
      }
      status.value = 'Waiting for the previous preview to stop…'
      await new Promise(resolve => setTimeout(resolve, BUSY_RETRY_MS))
      if (controller.signal.aborted) {
        return
      }
    }
  } catch (failure) {
    if (controller.signal.aborted) {
      return
    }
    error.value = failure instanceof Error ? failure.message : 'The preview failed'
  } finally {
    if (running === controller) {
      running = undefined
      loading.value = false
      status.value = ''
    }
  }
}

const runRecent = () => request({ kind: 'recent', limit: 50 })

// A builder opened from one item ("Create workflow…") previews that item as soon
// as the panel mounts, so the user sees the draft run against it immediately.
let previewedInitial = false
watch(() => props.initialRef, async (ref) => {
  if (!import.meta.client || !ref || previewedInitial) {
    return
  }
  previewedInitial = true
  activeTab.value = 'item'
  await request({ kind: 'item', ref })
}, { immediate: true })

// --- Pick an item ---------------------------------------------------------

const searchTerm = ref('')
const searchResults = ref<SearchHit[]>([])

watch(refDebounced(searchTerm, 250), async (value) => {
  const term = value.trim()
  if (term.length < 2) {
    searchResults.value = []
    return
  }
  try {
    const results = await $fetch<SearchResults>('/api/search', { query: { q: term, limit: 10 } })
    searchResults.value = results.groups
      .filter(group => group.domain === props.domain)
      .flatMap(group => group.hits)
  } catch {
    searchResults.value = []
  }
})

// --- Free text ------------------------------------------------------------

const freeText = ref('')

function selectItem(index: number) {
  selectedIndex.value = selectedIndex.value === index ? null : index
  const item = selectedIndex.value === null ? undefined : done.value[index]
  if (!item) {
    emit('highlight', [], [])
    return
  }
  emit('highlight', item.path.map(step => step.nodeId), pathEdges(props.graph, item.path))
}

function scoreEntries(answer: DecisionAnswer | undefined): Array<{ key: string, value: number }> {
  return answer?.scores ? Object.entries(answer.scores).map(([key, value]) => ({ key, value })) : []
}

/** The attempts one path step went through, as a chain line; undefined when there is nothing to show */
function attemptChain(step: WorkflowPathStep | undefined): string | undefined {
  return step?.attempts?.length ? decisionChainLabel(step) : undefined
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="border-b border-default px-3 pt-3">
      <UTabs
        v-model="activeTab"
        :items="tabs"
        :content="false"
        size="sm"
      />
    </div>

    <div class="flex-1 overflow-auto p-3">
      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        :title="error"
        class="mb-3"
      />
      <UAlert
        v-if="aiUnavailable"
        color="warning"
        variant="soft"
        icon="i-lucide-plug-zap"
        title="No Laya engine is configured, so decision nodes stop at other/unsure."
        class="mb-3"
      />

      <!-- Last 50 -->
      <template v-if="activeTab === 'recent'">
        <UButton
          label="Run on the last 50"
          icon="i-lucide-play"
          size="sm"
          :loading="loading"
          block
          @click="runRecent"
        />
      </template>

      <!-- Pick an item -->
      <template v-else-if="activeTab === 'item'">
        <UInput
          v-model="searchTerm"
          icon="i-lucide-search"
          placeholder="Search mail or documents"
          class="w-full"
        />
        <div v-if="searchResults.length" class="mt-2 space-y-1">
          <button
            v-for="hit in searchResults"
            :key="hit.ref"
            type="button"
            class="w-full rounded-md border border-default px-2 py-1.5 text-left text-xs transition hover:border-primary/50"
            @click="request({ kind: 'item', ref: hit.ref })"
          >
            <span class="line-clamp-1 font-medium text-highlighted">{{ hit.title }}</span>
            <span v-if="hit.subtitle" class="line-clamp-1 text-muted">{{ hit.subtitle }}</span>
          </button>
        </div>
      </template>

      <!-- Free text -->
      <template v-else>
        <UTextarea
          v-model="freeText"
          :rows="5"
          placeholder="Paste the text a decision should read, e.g. a mail body"
          class="w-full"
        />
        <UButton
          label="Ask the decision nodes"
          icon="i-lucide-sparkles"
          size="sm"
          class="mt-2"
          :loading="loading"
          :disabled="!freeText.trim()"
          block
          @click="request({ kind: 'text', text: freeText })"
        />
      </template>

      <!-- Progress of the running preview, in every tab -->
      <div v-if="loading" class="mt-3 space-y-1.5">
        <div class="flex items-center justify-between gap-2 text-xs text-muted">
          <span class="flex min-w-0 items-center gap-1.5">
            <UIcon name="i-lucide-loader-circle" class="size-3.5 shrink-0 animate-spin" />
            <span class="truncate">{{ status || 'Running…' }}</span>
          </span>
          <span class="flex shrink-0 items-center gap-2">
            <span v-if="started.length" class="tabular-nums">{{ doneCount }} / {{ started.length }}</span>
            <UButton
              label="Stop"
              icon="i-lucide-square"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="stop"
            />
          </span>
        </div>
        <UProgress
          :model-value="started.length ? doneCount : null"
          :max="started.length || 1"
          size="xs"
        />
      </div>

      <USeparator class="my-3" />

      <!-- Free-text answers: every decision node, with all probabilities -->
      <div v-if="activeTab === 'text' && textItem" class="space-y-3">
        <UAlert
          v-if="textItem.error"
          color="error"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="textItem.error"
        />
        <div v-for="node in decisionNodes" :key="node.id" class="rounded-md border border-default p-2">
          <button type="button" class="text-left text-xs font-semibold text-highlighted" @click="emit('focus', node.id)">
            {{ nodeTitle(node) }} · {{ node.data.instructions }}
          </button>
          <p v-if="textItem.answers[node.id]" class="mt-1 text-xs text-muted">
            → <span class="font-medium text-highlighted">{{ textItem.answers[node.id]!.choice ?? (textItem.answers[node.id]!.yes !== undefined ? `yes=${textItem.answers[node.id]!.yes!.toFixed(3)}` : '—') }}</span>
            · confidence {{ textItem.answers[node.id]!.confidence.toFixed(3) }}
          </p>
          <table v-if="scoreEntries(textItem.answers[node.id]).length" class="mt-1 w-full text-xs">
            <tbody>
              <tr v-for="score in scoreEntries(textItem.answers[node.id])" :key="score.key">
                <td class="py-0.5 pr-2 font-mono text-muted">
                  {{ score.key }}
                </td>
                <td class="py-0.5 text-right tabular-nums">
                  {{ score.value.toFixed(4) }}
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="mt-1 text-[11px] text-muted">
            Laya reports only P(true) and its confidence for a yes/no question.
          </p>
        </div>
      </div>

      <!-- Item answers: the selected item's path -->
      <div v-else-if="started.length" class="space-y-2">
        <template v-for="({ entry, item }, index) in rows" :key="entry.ref">
          <div
            v-if="!item"
            class="flex w-full items-center justify-between gap-2 rounded-md border border-dashed border-default p-2 text-xs text-muted"
          >
            <span class="line-clamp-1">{{ entry.title }}</span>
            <UIcon
              v-if="loading"
              name="i-lucide-loader-circle"
              class="size-3.5 shrink-0 animate-spin"
            />
            <span v-else class="shrink-0">stopped</span>
          </div>
          <button
            v-else
            type="button"
            class="w-full rounded-md border p-2 text-left text-xs transition"
            :class="selectedIndex === index ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/40'"
            @click="selectItem(index)"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="line-clamp-1 font-medium text-highlighted">{{ item.title }}</span>
              <UBadge
                v-if="item.error"
                size="sm"
                variant="subtle"
                color="error"
              >
                error
              </UBadge>
              <UBadge
                v-else-if="item.review"
                size="sm"
                variant="subtle"
                color="info"
              >
                would ask you
              </UBadge>
              <UBadge v-else-if="item.actions.length" size="sm" variant="subtle">
                {{ item.actions.length }} action{{ item.actions.length === 1 ? '' : 's' }}
              </UBadge>
              <UBadge
                v-else
                size="sm"
                variant="subtle"
                color="neutral"
              >
                no action
              </UBadge>
            </div>
            <p v-if="item.error" class="mt-1 text-error">
              {{ item.error }}
            </p>
            <p v-if="selectedIndex === index" class="mt-1 text-muted">
              {{ item.path.filter(step => step.nodeId !== 'trigger' && step.nodeId !== 'end').map(step => `${step.nodeId}:${step.output}`).join(' → ') || 'straight to the end' }}
            </p>
            <div v-if="selectedIndex === index && item.review" class="mt-1 rounded bg-info/10 p-1.5 text-info">
              <p class="font-medium">
                Would ask you: {{ item.path.find(step => step.nodeId === item.review)?.review?.instructions }}
              </p>
              <p v-if="attemptChain(item.path.find(step => step.nodeId === item.review))" class="text-[11px]">
                {{ attemptChain(item.path.find(step => step.nodeId === item.review)) }}
              </p>
            </div>
            <div v-if="selectedIndex === index && Object.keys(item.answers).length" class="mt-2 space-y-2">
              <div v-for="(answer, nodeId) in item.answers" :key="nodeId" class="rounded bg-elevated/60 p-1.5">
                <p class="font-medium text-highlighted">
                  {{ nodeId }}: {{ answer.choice ?? (answer.yes !== undefined ? `yes=${answer.yes.toFixed(3)}` : '—') }} ({{ answer.confidence.toFixed(3) }})
                </p>
                <p v-if="attemptChain(item.path.find(step => step.nodeId === nodeId))" class="text-[11px] text-muted">
                  {{ attemptChain(item.path.find(step => step.nodeId === nodeId)) }}
                </p>
                <p v-if="scoreEntries(answer).length" class="font-mono text-[10px] text-muted">
                  {{ scoreEntries(answer).map(score => `${score.key} ${score.value.toFixed(3)}`).join('  ') }}
                </p>
              </div>
            </div>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
