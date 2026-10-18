<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import type { MailMessage, MailSummary } from '#layers/mail/shared/types/mail'
import { buildReply } from '#layers/mail/shared/mail-compose'
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

const { data: mails, status, error, refresh } = await useFetch<MailSummary[]>(() => `/api/mail/conversations/${encodeURIComponent(props.conversationKey)}`, {
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

// --- Reply box ---

const replyText = ref('')
const sending = ref(false)
/** The text of the reply that is on its way, shown as an own bubble until the mail arrives */
const pending = ref<string | null>(null)

const ownAddresses = computed(() => props.ownAddress ? [props.ownAddress] : [])

// The reply answers the newest mail that is not the account's own
const latestIncoming = computed(() => [...(mails.value ?? [])].reverse().find(mail => !isOwnMail(mail, ownContext.value)))

// One full-message request per mail; the summary does not carry Message-ID or text
const messageCache = new Map<string, Promise<MailMessage>>()

function mailMessage(mail: MailSummary): Promise<MailMessage> {
  const key = mailKey(mail)
  let request = messageCache.get(key)
  if (!request) {
    request = $fetch<MailMessage>(`/api/mail/messages/${mail.uid}`, { query: { service: props.service, mailbox: mail.mailbox } })
    messageCache.set(key, request)
    request.catch(() => messageCache.delete(key))
  }
  return request
}

async function sendReply() {
  const text = replyText.value.trim()
  const target = latestIncoming.value

  if (!text || !target || sending.value) {
    return
  }

  sending.value = true
  pending.value = text

  try {
    const draft = buildReply(await mailMessage(target), ownAddresses.value, 'reply')
    await $fetch('/api/mail/send', {
      method: 'POST',
      query: { service: props.service },
      // The typed text goes above the quote buildReply prepared
      body: {
        ...draft,
        text: `${text}${draft.text}`,
        reply: { mailbox: target.mailbox, uid: target.uid }
      }
    })

    replyText.value = ''
    await refresh()
    pending.value = null
    toast.add({ title: 'Mail sent', color: 'success', icon: 'i-lucide-send' })
  } catch (error) {
    pending.value = null
    toast.add({ title: 'Could not send mail', description: mailErrorMessage(error), color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    sending.value = false
  }
}

// A sent mail is announced as a change; the conversation picks up its own copy
const refreshFromEvents = useDebounceFn(() => refresh(), 300)

useDomainEvents({ domains: ['mail'] }, (event) => {
  if (event.type === 'changed' && event.service === props.service) {
    refreshFromEvents()
  }
})
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

        <article v-if="pending" class="flex flex-col items-end gap-1">
          <span class="px-1 text-xs text-muted">me · sending…</span>
          <div class="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary/10 px-3 py-2 text-sm">
            {{ pending }}
          </div>
        </article>
      </div>
    </div>

    <div v-if="latestIncoming" class="border-t border-default p-4 sm:px-6">
      <UChatPrompt
        v-model="replyText"
        :rows="2"
        :autoresize="true"
        :maxrows="8"
        :disabled="sending"
        placeholder="Reply…"
        @submit="sendReply"
      >
        <template #footer>
          <UButton
            type="submit"
            icon="i-lucide-send"
            :loading="sending"
            :disabled="!replyText.trim()"
            aria-label="Send reply"
          />
        </template>
      </UChatPrompt>
    </div>
  </UDashboardPanel>
</template>
