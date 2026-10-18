<script setup lang="ts">
import { useIntervalFn, useNow } from '@vueuse/core'
import type { ServiceStatus } from '#layers/core/shared/types/dashboard'
import { serviceHealthMeta, serviceStatusLabel } from '../utils/dashboard'

const props = defineProps<{ services: ServiceStatus[] }>()

const now = useNow({ scheduler: callback => useIntervalFn(callback, 60_000) })

const items = computed(() => props.services.map(service => ({
  service,
  meta: serviceHealthMeta(service.health),
  label: serviceStatusLabel(service.health, service.syncedAt, now.value)
})))
</script>

<template>
  <ul class="flex flex-wrap items-center gap-x-6 gap-y-3">
    <li
      v-for="item in items"
      :key="item.service.id"
      class="flex min-w-0 items-center gap-3"
    >
      <UIcon :name="item.service.icon || 'i-lucide-plug'" class="size-5 shrink-0 text-muted" />

      <div class="min-w-0">
        <p class="truncate text-sm font-medium text-highlighted">
          {{ item.service.name }}
        </p>
        <UTooltip
          v-if="item.service.health === 'error' && item.service.error"
          :text="item.service.error"
        >
          <span class="flex items-center gap-1.5 text-xs" :style="{ color: item.meta.color }">
            <UIcon :name="item.meta.icon" class="size-3.5 shrink-0" />
            {{ item.label }}
          </span>
        </UTooltip>
        <span
          v-else
          class="flex items-center gap-1.5 text-xs"
          :style="{ color: item.meta.color }"
        >
          <UIcon
            :name="item.meta.icon"
            class="size-3.5 shrink-0"
            :class="item.meta.spinning && 'animate-spin'"
          />
          {{ item.label }}
        </span>
      </div>
    </li>
  </ul>
</template>
