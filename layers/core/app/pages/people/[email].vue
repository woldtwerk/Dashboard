<script setup lang="ts">
import type { EntityGraph } from '#layers/core/shared/types/entities'
import { entityKey, normalizeEmail } from '#layers/core/shared/entities'

const route = useRoute()
// Forwards the browser's cookies on the server; plain `$fetch` on the client
const requestFetch = useRequestFetch()

const email = computed(() => normalizeEmail(String(route.params.email ?? '')) ?? String(route.params.email ?? ''))
const entity = computed(() => ({ type: 'person', id: email.value }) as const)
const graphKey = computed(() => `entity-graph:${entityKey(entity.value)}:1`)

useSeoMeta({ title: () => email.value })

const { data: graph, status } = await useLazyAsyncData(
  graphKey,
  () => requestFetch<EntityGraph>('/api/entities/graph' as string, {
    query: { ref: entityKey(entity.value), depth: '1' }
  }),
  { default: () => ({ nodes: [], links: [], frontier: [] }) }
)

const graphTo = computed(() => `/graph?ref=${encodeURIComponent(entityKey(entity.value))}&depth=1`)
</script>

<template>
  <UDashboardPanel id="person">
    <UDashboardNavbar :title="email">
      <template #leading>
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/contacts"
          aria-label="Back to contacts"
        />
      </template>
    </UDashboardNavbar>

    <div class="flex-1 overflow-y-auto p-4">
      <div class="mx-auto w-full max-w-3xl space-y-6">
        <PersonDetails :email="email" :link-to-page="false" />

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-medium">
                Graph
              </h3>
              <UButton
                label="Open full graph"
                icon="i-lucide-waypoints"
                color="neutral"
                variant="ghost"
                size="xs"
                :to="graphTo"
              />
            </div>
          </template>

          <ClientOnly>
            <USkeleton v-if="status === 'pending'" class="h-[240px] w-full" />
            <EntityGraphView v-else :graph="graph" :height="240" />
          </ClientOnly>
        </UCard>
      </div>
    </div>
  </UDashboardPanel>
</template>
