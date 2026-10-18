<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import type { ImportantMail } from '#layers/mail/shared/mail-importance'
import { mailLink } from '#layers/mail/shared/mail-source'
import { formatRelative } from '#layers/core/app/utils/time'
import { useDashboardNow } from '#layers/core/app/composables/useDashboardNow'
import { useDomainEvents } from '#layers/core/app/composables/useDomainEvents'
import { formatMailAddress, mailKey } from '../../utils/mail'

const nuxtApp = useNuxtApp()
const now = useDashboardNow()

const { data: mails, status, refresh } = await useFetch<ImportantMail[]>('/api/mail/important', {
  key: 'dashboard-important-mail',
  query: { limit: 8 },
  lazy: true,
  default: () => []
})

const loading = computed(() => status.value === 'pending' && !mails.value.length)

// The domain sends `changed` events in bursts; one refresh per burst is enough
const refreshFromEvents = useDebounceFn(() => refresh(), 500)
useDomainEvents({ domains: ['mail'] }, (event) => {
  if (event.type === 'changed') {
    refreshFromEvents()
  }
}, {
  onReconnect: () => refreshFromEvents()
})

// Hovering a mail warms the payload key the mail page reads when it opens it
function prefetch(mail: ImportantMail) {
  if (!import.meta.client || !mail.service) {
    return
  }

  const key = `mail-linked:${mail.service}:${mail.mailbox}:${mail.uid}`
  if (nuxtApp.payload.data[key] !== undefined) {
    return
  }

  $fetch(`/api/mail/messages/${mail.uid}`, { query: { service: mail.service, mailbox: mail.mailbox } })
    .then((data) => {
      nuxtApp.payload.data[key] = data
    })
    .catch(() => {
      // A failed prefetch is not worth surfacing; opening the mail fetches for real
    })
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
