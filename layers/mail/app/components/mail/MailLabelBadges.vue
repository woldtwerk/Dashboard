<script setup lang="ts">
const props = defineProps<{
  labels?: string[]
  /** The label that marks a mail as done, rendered with a check and a success colour */
  doneLabel?: string
}>()

const isDone = (label: string) => !!props.doneLabel && label === props.doneLabel
</script>

<template>
  <UBadge
    v-for="label in labels ?? []"
    :key="label"
    :label="label"
    :icon="isDone(label) ? 'i-lucide-check' : undefined"
    :color="isDone(label) ? 'success' : 'neutral'"
    variant="subtle"
    size="sm"
  />
</template>
