<script setup lang="ts">
import type { DashboardMetric } from '#layers/core/shared/types/dashboard'
import { formatMetric } from '../utils/dashboard'

const props = defineProps<{ metric: DashboardMetric }>()

const value = computed(() => formatMetric(props.metric))
const available = computed(() => props.metric.value !== null && props.metric.value !== undefined)
</script>

<template>
  <UPageCard
    :title="metric.label"
    :icon="metric.icon || 'i-lucide-hash'"
    :to="metric.to"
    variant="subtle"
    :ui="{
      container: 'gap-y-1.5',
      wrapper: 'items-start',
      title: 'font-normal text-muted text-xs uppercase'
    }"
  >
    <div class="flex items-baseline gap-2">
      <span class="text-2xl font-semibold text-highlighted tabular-nums">{{ value }}</span>
      <span v-if="!available" class="text-xs text-muted">Not available</span>
    </div>
  </UPageCard>
</template>
