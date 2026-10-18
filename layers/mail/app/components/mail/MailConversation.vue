<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import type { MailMessage, MailSummary } from '#layers/mail/shared/types/mail'
import { buildReply } from '#layers/mail/shared/mail-compose'
import { isOwnMail, isStreamKey, streamLabel, stripSubjectPrefix, type OwnMailContext } from '#layers/mail/shared/mail-thread'
import type { MailComposeMode } from '#layers/mail/app/utils/mail-query'

const props = defineProps<{
  conversationKey: string
  service: string
  /** The account's own address, read from its service setup */
  ownAddress?: string
  /** Mailbox paths with special-use `\Sent` */
  sentMailboxes: string[]
}>()

const emits = defineEmits<{
  seen: []
  close: []
  compose: [mode: MailComposeMode, mail: MailSummary]
  delete: [mail: MailSummary]
}>()

const toast = useToast()

const { data: mails, status, error, refresh } = await useFetch<MailSummary[]>(() => `/api/mail/conversations/${encodeURIComponent(props.conversationKey)}`, {
  query: computed(() => ({ service: props.service })),
  default: () => [],
  lazy: true
})

// A stream is a mailing list or bulk sender; both kinds now read as one accordion
const isStream = computed(() => isStreamKey(props.conversationKey))

const title = computed(() => {
  const latest = mails.value?.at(-1)
  if (!latest) {
    return isStream.value ? 'Stream' : 'Conversation'
  }
  return isStream.value
    ? streamLabel(latest)
    : stripSubjectPrefix(latest.subject) || latest.subject || '(no subject)'
})

const ownContext = computed<OwnMailContext>(() => ({ ownAddress: props.ownAddress, sentMailboxes: props.sentMailboxes }))

const streamRef = ref<{ expandAll: () => void, collapseAll: () => void, expandNewest: () => void } | null>(null)

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
/** The reply that is on its way, shown as its own accordion item until the mail arrives */
const pendingReply = ref<{ text: string, subject: string } | null>(null)
/** A UID the mail server will never hand out, for the item shown while sending */
const PENDING_UID = -1

const ownAddresses = computed(() => props.ownAddress ? [props.ownAddress] : [])

// The reply answers the newest mail that is not the account's own
const latestIncoming = computed(() => [...(mails.value ?? [])].reverse().find(mail => !isOwnMail(mail, ownContext.value)))

const pendingMail = computed<MailSummary | null>(() => {
  const draft = pendingReply.value
  if (!draft) {
    return null
  }

  return {
    uid: PENDING_UID,
    service: props.service,
    mailbox: latestIncoming.value?.mailbox ?? '',
    subject: draft.subject,
    from: props.ownAddress ? [{ address: props.ownAddress }] : [],
    date: new Date().toISOString(),
    unread: false,
    flagged: false,
    snippet: 'sending…'
  }
})

const pendingItem = computed(() => pendingReply.value && pendingMail.value
  ? { mail: pendingMail.value, text: pendingReply.value.text }
  : null)

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

  try {
    const draft = buildReply(await mailMessage(target), ownAddresses.value, 'reply')
    pendingReply.value = { text, subject: draft.subject }

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
    pendingReply.value = null
    await nextTick()
    // The real copy of the sent mail takes the optimistic item's place
    streamRef.value?.expandNewest()
    toast.add({ title: 'Mail sent', color: 'success', icon: 'i-lucide-send' })
  } catch (error) {
    pendingReply.value = null
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

      <template #right>
        <UTooltip text="Expand all">
          <UButton
            icon="i-lucide-chevrons-down"
            color="neutral"
            variant="ghost"
            aria-label="Expand all"
            @click="streamRef?.expandAll()"
          />
        </UTooltip>
        <UTooltip text="Collapse all">
          <UButton
            icon="i-lucide-chevrons-up"
            color="neutral"
            variant="ghost"
            aria-label="Collapse all"
            @click="streamRef?.collapseAll()"
          />
        </UTooltip>
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
      <div v-else class="p-4 sm:p-6">
        <MailStreamList
          ref="streamRef"
          :mails="mails"
          :service="service"
          :own="ownContext"
          :pending="pendingItem"
          @compose="(mode, mail) => emits('compose', mode, mail)"
          @delete="mail => emits('delete', mail)"
        />
      </div>
    </div>

    <div v-if="latestIncoming && !isStream" class="border-t border-default p-4 sm:px-6">
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
