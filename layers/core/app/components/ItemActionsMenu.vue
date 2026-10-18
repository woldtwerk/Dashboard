<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ItemActionContext } from '#layers/core/app/utils/item-actions'
import { itemActionMenuItems } from '#layers/core/app/utils/item-actions'

/**
 * Generic actions menu for one item. A domain renders it with its context and
 * knows nothing about the actions other layers registered (see
 * `registerItemAction`); its own entries can be passed in `items`.
 */
const props = defineProps<{
  domain: string
  service: string
  /** The item's entity key, passed on to the actions as `ref` */
  entityRef: string
  item: Record<string, unknown>
  /** Domain owned entries, shown before the registered actions */
  items?: DropdownMenuItem[][]
  icon?: string
  size?: 'xs' | 'sm' | 'md'
}>()

const context = computed<ItemActionContext>(() => ({
  domain: props.domain,
  service: props.service,
  ref: props.entityRef,
  item: props.item
}))

const menuItems = computed(() => itemActionMenuItems(props.domain, context.value, props.items ?? []))
</script>

<template>
  <UDropdownMenu v-if="menuItems.length" :items="menuItems">
    <UButton
      :icon="icon ?? 'i-lucide-ellipsis-vertical'"
      color="neutral"
      variant="ghost"
      :size="size"
    />
  </UDropdownMenu>
</template>
