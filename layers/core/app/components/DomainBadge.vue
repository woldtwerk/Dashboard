<script setup lang="ts">
import { domainColor } from '../utils/chart'

defineProps<{ domain: string }>()
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-xs text-muted">
    <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: domainColor(domain) }" />
    {{ domain }}
  </span>
</template>
