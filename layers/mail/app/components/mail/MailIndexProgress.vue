<script setup lang="ts">
import type { MailIndexStatus } from '#layers/mail/shared/types/mail'
import { indexProgress } from '#layers/mail/shared/mail-index-progress'

const props = defineProps<{
  status: MailIndexStatus
  /** Account name, shown when several accounts index at once */
  name?: string
}>()

const progress = computed(() => indexProgress({
  indexed: props.status.indexed,
  total: props.status.total,
  complete: props.status.complete
}))
</script>

<template>
  <div v-if="!status.complete" class="space-y-1 border-b border-default px-4 py-2 sm:px-6">
    <p class="flex items-baseline gap-1.5 text-xs text-muted">
      <span class="truncate">
        <span v-if="name" class="font-medium text-highlighted">{{ name }} · </span>Indexing mail · {{ progress.label }} ({{ progress.percent }} %)
      </span>
      <span v-if="status.mailbox" class="shrink-0 truncate text-dimmed">· {{ status.mailbox }}</span>
    </p>
    <UProgress :model-value="progress.percent" size="xs" />
  </div>
</template>
