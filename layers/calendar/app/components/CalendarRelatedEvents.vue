<script setup lang="ts">
import type { EntityRef, Relation } from '#layers/core/shared/types/entities'
import { formatRelative } from '#layers/core/app/utils/time'
import { useDashboardNow } from '#layers/core/app/composables/useDashboardNow'
import { splitRelatedEvents } from '../utils/calendar-related'

const props = defineProps<{
  relations: Relation[]
  entity: EntityRef
}>()

const now = useDashboardNow()
const showPast = ref(false)
const split = computed(() => splitRelatedEvents(props.relations, now.value))
</script>

<template>
  <div class="space-y-1">
    <ul class="space-y-1">
      <li v-for="relation in split.upcoming" :key="relation.item.to">
        <NuxtLink :to="relation.item.to" class="flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-elevated/60">
          <UIcon :name="relation.item.icon || 'i-lucide-calendar'" class="size-4 shrink-0 text-muted" />
          <span class="min-w-0 flex-1 truncate">{{ relation.item.title }}</span>
          <span v-if="relation.item.at" class="shrink-0 text-xs text-dimmed">{{ formatRelative(relation.item.at, now) }}</span>
        </NuxtLink>
      </li>
    </ul>

    <UButton
      v-if="split.past.length"
      :label="`Show past (${split.past.length})`"
      icon="i-lucide-history"
      color="neutral"
      variant="ghost"
      size="xs"
      @click="showPast = !showPast"
    />

    <ul v-if="showPast" class="space-y-1">
      <li v-for="relation in split.past" :key="relation.item.to">
        <NuxtLink :to="relation.item.to" class="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-muted transition-colors hover:bg-elevated/60">
          <UIcon :name="relation.item.icon || 'i-lucide-calendar'" class="size-4 shrink-0 text-dimmed" />
          <span class="min-w-0 flex-1 truncate">{{ relation.item.title }}</span>
          <span v-if="relation.item.at" class="shrink-0 text-xs text-dimmed">{{ formatRelative(relation.item.at, now) }}</span>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
