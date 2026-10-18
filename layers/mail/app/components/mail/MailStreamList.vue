<script setup lang="ts">
import { format } from 'date-fns'
import type { MailSummary } from '#layers/mail/shared/types/mail'
import { stripSubjectPrefix } from '#layers/mail/shared/mail-thread'
import { highlightToHtml } from '#layers/mail/shared/mail-highlight'

const props = defineProps<{
  /** The stream's mails, oldest first, as the conversation endpoint returns them */
  mails: MailSummary[]
}>()

const emits = defineEmits<{
  open: [mail: MailSummary]
}>()

// A stream has no reply order to follow, so the newest mail comes first
const newestFirst = computed(() => [...props.mails].sort((a, b) => b.date.localeCompare(a.date)))
</script>

<template>
  <div class="flex flex-col gap-2">
    <button
      v-for="mail in newestFirst"
      :key="mailKey(mail)"
      type="button"
      class="flex flex-col gap-1 rounded-lg border border-default p-3 text-left text-sm transition-colors hover:border-primary hover:bg-primary/5"
      @click="emits('open', mail)"
    >
      <div class="flex items-center justify-between gap-2 text-xs text-muted">
        <span class="truncate">{{ formatMailAddress(mail.from[0]) }}</span>
        <span class="shrink-0">{{ format(new Date(mail.date), 'dd MMM yyyy HH:mm') }}</span>
      </div>

      <p class="truncate" :class="[mail.unread ? 'font-semibold text-highlighted' : 'text-toned']">
        {{ stripSubjectPrefix(mail.subject) || '(no subject)' }}
      </p>

      <!-- eslint-disable-next-line vue/no-v-html -- highlightToHtml escapes the mail content -->
      <p v-if="mail.snippet" class="line-clamp-2 text-dimmed" v-html="highlightToHtml(mail.snippet)" />
    </button>
  </div>
</template>
