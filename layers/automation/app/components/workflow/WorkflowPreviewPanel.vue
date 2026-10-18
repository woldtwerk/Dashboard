<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import type { SearchHit, SearchResults } from '#layers/core/shared/types/search'
import type { AutomationDomain, DecisionAnswer, WorkflowGraph, WorkflowPreviewResult, WorkflowPreviewSource } from '../../../shared/types/automation'
import { pathEdges } from '../../utils/workflow-edit'
import { nodeTitle } from '../../utils/workflow-view'

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
const result = ref<WorkflowPreviewResult | null>(null)
const selectedIndex = ref<number | null>(null)

const decisionNodes = computed(() => props.graph.nodes.filter(node => node.type === 'decision'))

async function request(source: WorkflowPreviewSource) {
  loading.value = true
  error.value = ''
  selectedIndex.value = null
  emit('highlight', [], [])

  try {
    result.value = await $fetch<WorkflowPreviewResult>('/api/automation/preview', {
      method: 'POST',
      body: { graph: props.graph, domain: props.domain, service: props.service, source }
    })
  } catch (failure) {
    result.value = null
    error.value = failure instanceof Error ? failure.message : 'The preview failed'
  } finally {
    loading.value = false
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
  const item = result.value?.items[index]
  if (!item) {
    emit('highlight', [], [])
    return
  }
  emit('highlight', item.path.map(step => step.nodeId), pathEdges(props.graph, item.path))
}

function scoreEntries(answer: DecisionAnswer | undefined): Array<{ key: string, value: number }> {
  return answer?.scores ? Object.entries(answer.scores).map(([key, value]) => ({ key, value })) : []
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
        v-if="result?.aiUnavailable"
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
            :disabled="loading"
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

      <USeparator class="my-3" />

      <!-- Free-text answers: every decision node, with all probabilities -->
      <div v-if="activeTab === 'text' && result?.items.length" class="space-y-3">
        <div v-for="node in decisionNodes" :key="node.id" class="rounded-md border border-default p-2">
          <button type="button" class="text-left text-xs font-semibold text-highlighted" @click="emit('focus', node.id)">
            {{ nodeTitle(node) }} · {{ node.data.instructions }}
          </button>
          <p v-if="result.items[0]!.answers[node.id]" class="mt-1 text-xs text-muted">
            → <span class="font-medium text-highlighted">{{ result.items[0]!.answers[node.id]!.choice ?? (result.items[0]!.answers[node.id]!.yes !== undefined ? `yes=${result.items[0]!.answers[node.id]!.yes!.toFixed(3)}` : '—') }}</span>
            · confidence {{ result.items[0]!.answers[node.id]!.confidence.toFixed(3) }}
          </p>
          <table v-if="scoreEntries(result.items[0]!.answers[node.id]).length" class="mt-1 w-full text-xs">
            <tbody>
              <tr v-for="score in scoreEntries(result.items[0]!.answers[node.id])" :key="score.key">
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
      <div v-else-if="result?.items.length" class="space-y-2">
        <button
          v-for="(item, index) in result.items"
          :key="item.ref"
          type="button"
          class="w-full rounded-md border p-2 text-left text-xs transition"
          :class="selectedIndex === index ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/40'"
          @click="selectItem(index)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="line-clamp-1 font-medium text-highlighted">{{ item.title }}</span>
            <UBadge v-if="item.actions.length" size="sm" variant="subtle">
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
          <p v-if="selectedIndex === index" class="mt-1 text-muted">
            {{ item.path.filter(step => step.nodeId !== 'trigger' && step.nodeId !== 'end').map(step => `${step.nodeId}:${step.output}`).join(' → ') || 'straight to the end' }}
          </p>
          <div v-if="selectedIndex === index && Object.keys(item.answers).length" class="mt-2 space-y-2">
            <div v-for="(answer, nodeId) in item.answers" :key="nodeId" class="rounded bg-elevated/60 p-1.5">
              <p class="font-medium text-highlighted">
                {{ nodeId }}: {{ answer.choice ?? (answer.yes !== undefined ? `yes=${answer.yes.toFixed(3)}` : '—') }} ({{ answer.confidence.toFixed(3) }})
              </p>
              <p v-if="scoreEntries(answer).length" class="font-mono text-[10px] text-muted">
                {{ scoreEntries(answer).map(score => `${score.key} ${score.value.toFixed(3)}`).join('  ') }}
              </p>
            </div>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
