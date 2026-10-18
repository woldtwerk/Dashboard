<script setup lang="ts">
import type { EntityRef, Relation } from '#layers/core/shared/types/entities'
import { documentsFileUrl } from '../utils/documents-request'
import { documentRelationBadge } from '../utils/documents-related'

const props = defineProps<{
  relations: Relation[]
  entity: EntityRef
}>()

function thumb(relation: Relation): string | undefined {
  const id = Number(relation.item.ref.id)
  if (!Number.isInteger(id) || !relation.item.ref.service) {
    return undefined
  }
  return documentsFileUrl('thumb', relation.item.ref.service, id)
}
</script>

<template>
  <ul class="space-y-1">
    <li v-for="relation in props.relations" :key="relation.item.to">
      <NuxtLink :to="relation.item.to" class="flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-elevated/60">
        <span class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border border-default bg-elevated/40">
          <img
            v-if="thumb(relation)"
            :src="thumb(relation)"
            :alt="relation.item.title"
            loading="lazy"
            class="size-full object-cover object-top"
          >
          <UIcon v-else name="i-lucide-file-text" class="size-4 text-dimmed" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate">{{ relation.item.title }}</span>
          <span v-if="relation.item.subtitle" class="block truncate text-xs text-dimmed">{{ relation.item.subtitle }}</span>
        </span>
        <UBadge
          :label="documentRelationBadge(relation.kind).label"
          :color="documentRelationBadge(relation.kind).color"
          variant="subtle"
          size="sm"
        />
      </NuxtLink>
    </li>
  </ul>
</template>
