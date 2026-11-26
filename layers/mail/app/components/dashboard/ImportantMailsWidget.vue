<script setup lang="ts">
import type { ImportantMail } from '#layers/mail/shared/mail-importance'
import { mailLink } from '#layers/mail/shared/mail-source'
import { formatRelative } from '#layers/core/app/utils/time'
import { useDashboardNow } from '#layers/core/app/composables/useDashboardNow'
import { formatMailAddress, mailKey } from '../../utils/mail'

const queryCache = useQueryCache()
const requestFetch = useRequestFetch()
const now = useDashboardNow()

const { data: importantMails, status } = useQuery<ImportantMail[]>({
  key: ['mail', 'important'],
  query: () => requestFetch<ImportantMail[]>('/api/mail/important', { query: { limit: 8 } }),
  ssrCatchError: true
})
const mails = computed(() => importantMails.value ?? [])

const loading = computed(() => status.value === 'pending' && !mails.value.length)

// Hovering a mail warms the same message query the mail page reads when it opens
function prefetch(mail: ImportantMail) {
  if (!import.meta.client || !mail.service) {
    return
  }

  prefetchMailMessage(queryCache, requestFetch, mail.service, mail.mailbox, mail.uid)
}

function link(mail: ImportantMail) {
  return mailLink(mail.service ?? '', mail.mailbox, mail.uid)
}
</script>

<template>
  <div v-if="loading" class="space-y-2">
    <USkeleton v-for="index in 4" :key="index" class="h-10 w-full" />
  </div>

  <ul v-else-if="mails.length" class="divide-y divide-default">
    <li v-for="mail in mails" :key="mailKey(mail)">
      <NuxtLink
        :to="link(mail)"
        class="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-elevated/60"
        @mouseenter="prefetch(mail)"
        @focus="prefetch(mail)"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-highlighted">
            {{ formatMailAddress(mail.from[0]) }}
          </p>
          <p class="truncate text-sm text-muted">
            {{ mail.subject || '(no subject)' }}
          </p>
        </div>

        <UBadge
          v-for="reason in mail.reasons"
          :key="reason"
          :label="reason"
          color="neutral"
          variant="subtle"
          size="sm"
        />

        <span class="w-20 shrink-0 text-right text-xs text-muted tabular-nums">
          {{ formatRelative(mail.date, now) }}
        </span>
      </NuxtLink>
    </li>
  </ul>

  <UEmpty
    v-else
    icon="i-lucide-mail-check"
    title="Nothing important right now"
    variant="naked"
    class="py-8"
  />
</template>
