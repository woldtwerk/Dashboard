<script setup lang="ts">
import type { LogLevel } from '#layers/core/shared/types/logs'
import { logLevelMeta } from '../utils/logs'

const props = defineProps<{ level: LogLevel }>()

const meta = computed(() => logLevelMeta(props.level))
</script>

<template>
  <UBadge :color="meta.tone" variant="subtle" size="sm">
    <template #leading>
      <UIcon :name="meta.icon" />
    </template>
    {{ meta.label }}
  </UBadge>
</template>
