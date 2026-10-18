<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import type { EntityRef, RelatedGroup } from '#layers/core/shared/types/entities'
import { entityKey } from '#layers/core/shared/entities'
import { domainColor } from '../utils/chart'
import { formatRelative } from '../utils/time'
import { relatedKey, splitRelations } from '../utils/related'
import { useRelatedRenderer } from '../composables/useRelatedRenderers'
import { useDashboardNow } from '../composables/useDashboardNow'

const props = defineProps<{ entity: EntityRef }>()

const now = useDashboardNow()
const nuxtApp = useNuxtApp()

const limit = ref(5)

const { data: groups, status, refresh } = await useFetch<RelatedGroup[]>('/api/entities/related' as string, {
  key: () => relatedKey(props.entity),
  query: computed(() => ({ ref: entityKey(props.entity), limit: String(limit.value) })),
  lazy: true,
  default: () => [],
  // A hover prefetched into the payload cache is served from there
  getCachedData: key => nuxtApp.payload.data[key]
})

const loading = computed(() => status.value === 'pending' && !groups.value.length)

// The domain `changed` events arrive in bursts; one refresh per burst is enough
const refreshFromEvents = useDebounceFn(() => refresh(), 300)
useDomainEvents({}, (event) => {
  if (event.type === 'changed') {
    refreshFromEvents()
  }
}, {
  onReconnect: () => refreshFromEvents()
})

// Hovering an item warms the cache its own related panel reads from
function prefetch(ref: EntityRef) {
  if (!import.meta.client) {
    return
  }
  const key = relatedKey(ref)
  if (nuxtApp.payload.data[key] !== undefined) {
    return
  }
  $fetch<RelatedGroup[]>('/api/entities/related' as string, { query: { ref: entityKey(ref) } })
    .then((data) => {
      nuxtApp.payload.data[key] = data
    })
    .catch(() => {
      // A failed prefetch is not worth surfacing; opening the item fetches for real
    })
}

function showMore() {
  limit.value += 5
  refresh()
}
</script>

<template>
  <div class="space-y-5">
    <template v-if="loading">
      <div v-for="index in 2" :key="index" class="space-y-3">
        <USkeleton class="h-4 w-32" />
        <USkeleton class="h-12 w-full" />
        <USkeleton class="h-12 w-full" />
      </div>
    </template>

    <UEmpty
      v-else-if="!groups.length"
      icon="i-lucide-link"
      title="No related items"
      description="Nothing in your other services links to this yet."
      variant="naked"
      class="py-8"
    />

    <section v-for="group in groups" :key="group.domain" class="space-y-2">
      <h3 class="flex items-center gap-2 text-xs font-semibold uppercase text-muted">
        <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: domainColor(group.domain) }" />
        {{ group.label }}
        <UBadge
          :label="group.relations.length"
          variant="subtle"
          color="neutral"
          size="sm"
        />
      </h3>

      <!-- A domain may bring its own block for its group -->
      <component
        :is="useRelatedRenderer(group.domain)"
        v-if="useRelatedRenderer(group.domain)"
        :relations="group.relations"
        :entity="entity"
      />

      <template v-else>
        <ul class="space-y-1">
          <li v-for="relation in splitRelations(group.relations).structural" :key="relation.item.to + relation.kind">
            <NuxtLink
              :to="relation.item.to"
              class="flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-elevated/60"
              @mouseenter="prefetch(relation.item.ref)"
            >
              <UIcon :name="relation.item.icon || 'i-lucide-link'" class="size-4 shrink-0 text-muted" />
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ relation.item.title }}</span>
                <span v-if="relation.item.subtitle" class="block truncate text-xs text-dimmed">{{ relation.item.subtitle }}</span>
              </span>
              <span v-if="relation.item.at" class="shrink-0 text-xs text-dimmed">{{ formatRelative(relation.item.at, now) }}</span>
            </NuxtLink>
          </li>
        </ul>

        <template v-if="splitRelations(group.relations).mentions.length">
          <p class="px-2 pt-1 text-xs font-medium text-dimmed">
            Mentioned
          </p>
          <ul class="space-y-1">
            <li v-for="relation in splitRelations(group.relations).mentions" :key="relation.item.to + relation.kind">
              <NuxtLink
                :to="relation.item.to"
                class="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-muted transition-colors hover:bg-elevated/60"
                @mouseenter="prefetch(relation.item.ref)"
              >
                <UIcon :name="relation.item.icon || 'i-lucide-message-square-quote'" class="size-4 shrink-0 text-dimmed" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate">{{ relation.item.title }}</span>
                  <span v-if="relation.item.subtitle" class="block truncate text-xs text-dimmed">{{ relation.item.subtitle }}</span>
                </span>
                <span v-if="relation.item.at" class="shrink-0 text-xs text-dimmed">{{ formatRelative(relation.item.at, now) }}</span>
              </NuxtLink>
            </li>
          </ul>
        </template>

        <UButton
          v-if="group.truncated"
          label="Show more"
          icon="i-lucide-plus"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="showMore"
        />
      </template>
    </section>
  </div>
</template>
