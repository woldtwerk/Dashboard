<script setup lang="ts">
import type { MailSummary } from '#layers/mail/shared/types/mail'
import { isOwnMail, stripSubjectPrefix, type OwnMailContext } from '#layers/mail/shared/mail-thread'

const props = defineProps<{
  conversationKey: string
  service: string
  /** The account's own address, read from its service setup */
  ownAddress?: string
  /** Mailbox paths with special-use `\Sent` */
  sentMailboxes: string[]
}>()

const emits = defineEmits<{
  open: [mail: MailSummary]
  seen: []
  close: []
}>()

const toast = useToast()

const { data: mails, status, error } = await useFetch<MailSummary[]>(() => `/api/mail/conversations/${encodeURIComponent(props.conversationKey)}`, {
  query: computed(() => ({ service: props.service })),
  default: () => [],
  lazy: true
})

const title = computed(() => {
  const latest = mails.value?.at(-1)
  return latest ? stripSubjectPrefix(latest.subject) || latest.subject || '(no subject)' : 'Conversation'
})

const ownContext = computed<OwnMailContext>(() => ({ ownAddress: props.ownAddress, sentMailboxes: props.sentMailboxes }))

const scroller = ref<HTMLElement | null>(null)

function scrollToNewest() {
  const element = scroller.value
  if (element) {
    element.scrollTop = element.scrollHeight
  }
}

// Marked as seen optimistically; the keys are kept apart from the data so a failed
// PATCH only backs out its own mail.
const seen = ref(new Set<string>())

async function markSeen() {
  const unread = (mails.value ?? []).filter(mail => mail.unread && !seen.value.has(mailKey(mail)))
  if (!unread.length) {
    return
  }

  for (const mail of unread) {
    seen.value.add(mailKey(mail))
  }

  const results = await Promise.allSettled(unread.map(mail => $fetch(`/api/mail/messages/${mail.uid}`, {
    method: 'PATCH',
    query: { service: props.service, mailbox: mail.mailbox },
    body: { seen: true }
  })))

  const failed = results.filter(result => result.status === 'rejected').length
  if (failed) {
    unread.forEach((mail, index) => {
      if (results[index]!.status === 'rejected') {
        seen.value.delete(mailKey(mail))
      }
    })
    toast.add({ title: 'Could not mark some messages as read', color: 'error', icon: 'i-lucide-circle-alert' })
  }

  emits('seen')
}

watch(mails, async () => {
  await nextTick()
  scrollToNewest()
  await markSeen()
}, { immediate: true })
</script>

<template>
  <UDashboardPanel id="mail-2">
    <UDashboardNavbar :title="title" :toggle="false">
      <template #leading>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          class="-ms-1.5"
          @click="emits('close')"
        />
      </template>
    </UDashboardNavbar>

    <div ref="scroller" class="flex-1 min-h-0 overflow-y-auto">
      <div v-if="status === 'pending'" class="flex items-center justify-center p-8">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-dimmed" />
      </div>
      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Could not load conversation"
        :description="error.statusMessage || error.message"
        class="m-4"
      />
      <div v-else class="flex flex-col gap-4 p-4 sm:p-6">
        <MailConversationMessage
          v-for="mail in mails"
          :key="mailKey(mail)"
          :mail="mail"
          :service="service"
          :own="isOwnMail(mail, ownContext)"
          @open="emits('open', mail)"
        />
      </div>
    </div>
  </UDashboardPanel>
</template>
