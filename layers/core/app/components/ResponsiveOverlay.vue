<script setup lang="ts">
import { breakpointsTailwind } from '@vueuse/core'
import { UDrawer, USlideover } from '#components'

const open = defineModel<boolean>('open', { required: true })

withDefaults(defineProps<{
  title?: string
  description?: string
  close?: boolean | Record<string, unknown>
  dismissible?: boolean
  side?: 'left' | 'right' | 'top' | 'bottom'
  ui?: Record<string, unknown>
}>(), {
  close: true,
  dismissible: true,
  side: 'right'
})

const isMobile = useBreakpoints(breakpointsTailwind).smaller('lg')
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
const isDrawer = computed(() => mounted.value && isMobile.value)

// Full screen on a phone; the handle is the swipe-down affordance
const drawerUi = {
  content: 'h-dvh max-h-none rounded-none mt-0',
  container: 'flex-1 min-h-0 overflow-hidden',
  body: 'min-h-0 overflow-y-auto'
}
</script>

<template>
  <component
    :is="isDrawer ? UDrawer : USlideover"
    v-model:open="open"
    v-bind="isDrawer ? { direction: 'bottom', ui: drawerUi } : { side, ui }"
    :title="title"
    :description="description"
    :close="close"
    :dismissible="dismissible"
  >
    <template v-for="(_, name) in $slots" :key="name" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps ?? {}" />
    </template>
  </component>
</template>
