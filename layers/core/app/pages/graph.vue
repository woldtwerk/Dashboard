<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import type { EntityGraph, GraphNode } from '#layers/core/shared/types/entities'
import { entityKey, parseEntityKey } from '#layers/core/shared/entities'
import { expandNode } from '../utils/graph'

useSeoMeta({ title: 'Graph' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

const EMPTY: EntityGraph = { nodes: [], links: [], frontier: [] }

const queryString = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : undefined

function updateQuery(patch: Record<string, string | null>) {
  router.replace({ query: Object.fromEntries(Object.entries({ ...route.query, ...patch }).filter(([, value]) => value)) })
}

const entity = computed(() => parseEntityKey(queryString('ref')))
const depth = computed(() => queryString('depth') === '2' ? 2 : 1)

const { data, status, error, refresh } = await useLazyAsyncData(
  () => entity.value ? `entity-graph:${entityKey(entity.value)}:${depth.value}` : 'entity-graph:empty',
  async (): Promise<EntityGraph> => {
    if (!entity.value) {
      return EMPTY
    }
    return await $fetch<EntityGraph>('/api/entities/graph' as string, {
      query: { ref: entityKey(entity.value), depth: String(depth.value) }
    })
  },
  { default: () => EMPTY, watch: [entity, depth] }
)

// The drawn graph keeps frontier nodes across an expand, so it is not the same as the fetch result
const graph = ref<EntityGraph>(EMPTY)
watch(data, (value) => {
  graph.value = value ?? EMPTY
}, { immediate: true })

const selectedKey = computed(() => queryString('node'))
const selectedNode = computed(() => graph.value.nodes.find(node => node.key === selectedKey.value) ?? null)
const loading = computed(() => status.value === 'pending')

function select(node: GraphNode) {
  updateQuery({ node: node.key })
}

const expanding = ref(false)

// Fetch the node's own neighbourhood and merge it into the graph that is drawn
async function expandNodeInGraph(node: GraphNode) {
  expanding.value = true
  try {
    const fetched = await $fetch<EntityGraph>('/api/entities/graph' as string, {
      query: { ref: node.key, depth: '1' }
    })
    graph.value = expandNode(graph.value, node.key, fetched)
    updateQuery({ node: node.key })
  } catch {
    toast.add({ title: 'Could not expand the node', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    expanding.value = false
  }
}

const depthTabs = [{ label: '1 hop', value: '1' }, { label: '2 hops', value: '2' }]
const selectedDepth = computed({
  get: () => String(depth.value),
  set: (value: string) => updateQuery({ depth: value, node: null })
})

// A domain change re-reads the graph from the reference entity
const refetch = useDebounceFn(() => refresh(), 300)
useDomainEvents({}, (event) => {
  if (event.type === 'changed') {
    refetch()
  }
}, {
  onReconnect: () => refetch()
})
</script>

<template>
  <UDashboardPanel id="graph">
    <UDashboardNavbar title="Graph">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #trailing>
        <UBadge
          v-if="graph.nodes.length"
          :label="graph.nodes.length"
          variant="subtle"
        />
      </template>
      <template #right>
        <UTabs
          v-model="selectedDepth"
          :items="depthTabs"
          :content="false"
          size="xs"
        />
      </template>
    </UDashboardNavbar>

    <div class="flex flex-1 min-h-0">
      <div class="flex-1 min-w-0 overflow-auto p-4">
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Could not load the graph"
          :description="error.statusMessage || error.message"
          class="mb-4"
        />

        <UEmpty
          v-else-if="!entity"
          icon="i-lucide-waypoints"
          title="Nothing selected"
          description="Open an item and choose “Show in graph” to explore how it connects."
          variant="naked"
          class="py-24"
        />

        <USkeleton v-else-if="loading" class="h-[480px] w-full" />

        <ClientOnly v-else>
          <EntityGraphView
            :graph="graph"
            :selected="selectedKey"
            :height="480"
            @select="select"
            @expand="expandNodeInGraph"
          />
        </ClientOnly>
      </div>

      <aside
        v-if="selectedNode"
        class="w-80 shrink-0 overflow-y-auto border-s border-default p-4 max-lg:hidden"
      >
        <div class="mb-4 flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate font-semibold text-highlighted">
              {{ selectedNode.label }}
            </p>
            <p class="text-xs text-muted">
              {{ selectedNode.type }}
            </p>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Close panel"
            @click="updateQuery({ node: null })"
          />
        </div>

        <div class="mb-4 flex flex-wrap gap-2">
          <UButton
            label="Open"
            icon="i-lucide-arrow-up-right"
            size="sm"
            :to="selectedNode.to"
          />
          <UButton
            label="Expand"
            icon="i-lucide-network"
            color="neutral"
            variant="outline"
            size="sm"
            :loading="expanding"
            @click="expandNodeInGraph(selectedNode)"
          />
        </div>

        <h3 class="mb-2 text-xs font-semibold uppercase text-muted">
          Related
        </h3>
        <RelatedPanel :entity="selectedNode.ref" />
      </aside>
    </div>
  </UDashboardPanel>
</template>
