<script setup lang="ts">
import type { MailAddress, MailMessage, MailSummary } from '#layers/mail/shared/types/mail'
import type { OwnMailContext } from '#layers/mail/shared/mail-thread'
import { isTrustedImageSender } from '#layers/mail/shared/mail-images'
import { entityKey } from '#layers/core/shared/entities'
import type { MailComposeMode } from '#layers/mail/app/utils/mail-query'
import { formatMailFullDate } from '#layers/mail/app/utils/mail-date'

const props = defineProps<{
  /** The conversation's mails, oldest first as the endpoint returns them */
  mails: MailSummary[]
  service: string
  /** The account's own address and sent mailboxes, so own mail reads as "me" */
  own?: OwnMailContext
  /** A reply on its way, shown as its own item until the real one arrives */
  pending?: { mail: MailSummary, text: string } | null
}>()

const emits = defineEmits<{
  compose: [mode: MailComposeMode, mail: MailSummary]
  delete: [mail: MailSummary]
}>()

// One zone for the whole conversation, resolved once; the items only format with it
const zone = useTimeZone()

// The optimistic reply is the newest item while it is on its way
const allMails = computed(() => props.pending ? [...props.mails, props.pending.mail] : props.mails)

const items = computed(() => accordionItems(allMails.value, props.own))

const byValue = computed(() => new Map(allMails.value.map(mail => [mailKey(mail), mail])))

const latest = computed(() => allMails.value.at(-1))

const mailFor = (value: string) => byValue.value.get(value)
const isPending = (value: string) => !!props.pending && value === mailKey(props.pending.mail)

// --- Full messages, fetched when an item opens and kept per key ---

const messages = ref<Record<string, MailMessage>>({})
const loading = ref<Record<string, boolean>>({})
const failed = ref<Record<string, boolean>>({})
const remoteAllowed = ref<Set<string>>(new Set())
const { trustedImageSenders, trust, untrust } = useTrustedImageSenders()
// One request per mail, so collapsing and expanding again does not fetch twice
const requests = new Map<string, Promise<MailMessage>>()

const messageFor = (value: string) => messages.value[value]

function loadMessage(mail: MailSummary) {
  const value = mailKey(mail)
  if (messages.value[value] || requests.has(value)) {
    return
  }

  loading.value = { ...loading.value, [value]: true }
  const request = $fetch<MailMessage>(`/api/mail/messages/${mail.uid}`, {
    query: { service: props.service, mailbox: mail.mailbox }
  })
  requests.set(value, request)
  request.catch(() => requests.delete(value))

  request.then(
    (message) => {
      messages.value = { ...messages.value, [value]: message }
    },
    () => {
      failed.value = { ...failed.value, [value]: true }
    }
  ).finally(() => {
    loading.value = { ...loading.value, [value]: false }
  })
}

/** Warm the message an expand will need; the header is hovered before it is clicked */
function prefetch(value: string) {
  const mail = mailFor(value)
  if (mail && !isPending(value)) {
    loadMessage(mail)
  }
}

// --- Which items are open ---

const expanded = ref<string[]>([])
const initialized = ref(false)

watch(items, () => {
  const values = items.value.map(item => item.value)
  if (!initialized.value) {
    // Arriving at a conversation shows its newest mail and leaves the rest folded
    expanded.value = defaultExpanded(allMails.value)
    initialized.value = true
  } else {
    // A refresh must not leave a mail that is gone open
    expanded.value = expanded.value.filter(value => values.includes(value))
  }
}, { immediate: true })

// The optimistic reply opens at once, so the sender sees what is on its way
watch(() => props.pending, (pending) => {
  if (!pending) {
    return
  }
  const value = mailKey(pending.mail)
  if (!expanded.value.includes(value)) {
    expanded.value = [...expanded.value, value]
  }
}, { immediate: true })

function expandAll() {
  expanded.value = items.value.map(item => item.value)
}

function collapseAll() {
  expanded.value = []
}

function expandNewest() {
  const value = latest.value ? mailKey(latest.value) : undefined
  if (value && !expanded.value.includes(value)) {
    expanded.value = [...expanded.value, value]
  }
}

defineExpose({ expandAll, collapseAll, expandNewest })

watch(expanded, (values) => {
  for (const value of values) {
    if (isPending(value)) {
      continue
    }
    const mail = mailFor(value)
    if (mail) {
      loadMessage(mail)
    }
  }
}, { immediate: true })

// --- Rendering helpers ---

function mailDate(value: string): string {
  const mail = mailFor(value)
  return mail ? formatMailFullDate(mail.date, zone.value) : ''
}

function addressLine(addresses: MailAddress[] = []): string {
  return addresses.map(formatMailAddress).join(', ')
}

function recipientLine(value: string): string {
  return addressLine(messageFor(value)?.to)
}

function copyLine(value: string): string {
  return addressLine(messageFor(value)?.cc)
}

function allowsRemote(value: string): boolean {
  return remoteAllowed.value.has(value)
    || isTrustedImageSender(messageFor(value)?.from[0]?.address, trustedImageSenders.value)
}

function setRemoteAllowed(value: string, allowed: boolean) {
  const next = new Set(remoteAllowed.value)
  if (allowed) {
    next.add(value)
  } else {
    next.delete(value)
  }
  remoteAllowed.value = next
}

function composeFor(value: string, mode: MailComposeMode) {
  const mail = mailFor(value)
  if (mail) {
    emits('compose', mode, mail)
  }
}

function deleteFor(value: string) {
  const mail = mailFor(value)
  if (mail) {
    emits('delete', mail)
  }
}

/** The entity key and the fields the generic item actions menu reads */
function mailRef(value: string): string {
  const mail = mailFor(value)
  return mail ? entityKey({ type: 'mail', service: props.service, id: `${mail.mailbox}/${mail.uid}` }) : ''
}

function actionContext(value: string): Record<string, unknown> {
  const mail = mailFor(value)
  return {
    from: mail?.from ?? [],
    to: mail?.to,
    subject: mail?.subject,
    mailbox: mail?.mailbox,
    listId: mail?.listId,
    snippet: mail?.snippet
  }
}
</script>

<template>
  <UAccordion
    v-model="expanded"
    type="multiple"
    :items="items"
    :ui="{
      root: 'overflow-hidden rounded-lg border border-default',
      trigger: 'px-4 sm:px-6',
      label: 'min-w-0 flex-1'
    }"
  >
    <template #default="{ item, open }">
      <div class="flex min-w-0 flex-1 items-start gap-2" @mouseenter="prefetch(item.value)">
        <UChip v-if="mailFor(item.value)?.unread" class="mt-1.5 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-2">
            <span class="truncate" :class="item.isOwn ? 'text-muted' : 'text-highlighted'">{{ item.sender }}</span>
            <span class="shrink-0 text-xs font-normal text-muted">{{ mailDate(item.value) }}</span>
          </div>

          <p v-if="isPending(item.value)" class="truncate text-xs font-normal text-dimmed">
            sending…
          </p>
          <p v-else-if="!open" class="truncate text-xs font-normal text-dimmed">
            {{ item.snippet || item.label }}
          </p>
        </div>
      </div>
    </template>

    <template #content="{ item }">
      <div class="space-y-3 border-t border-default/60 px-4 pb-4 pt-3 sm:px-6">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p v-if="recipientLine(item.value)" class="min-w-0 truncate text-xs text-muted">
            To: {{ recipientLine(item.value) }}
            <template v-if="copyLine(item.value)">
              · Cc: {{ copyLine(item.value) }}
            </template>
          </p>
          <span v-else class="min-w-0 truncate text-xs text-dimmed">{{ item.label }}</span>

          <div v-if="!isPending(item.value)" class="flex shrink-0 items-center gap-0.5">
            <UTooltip text="Reply">
              <UButton
                icon="i-lucide-reply"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Reply"
                @click="composeFor(item.value, 'reply')"
              />
            </UTooltip>
            <UTooltip text="Reply all">
              <UButton
                icon="i-lucide-reply-all"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Reply all"
                @click="composeFor(item.value, 'replyAll')"
              />
            </UTooltip>
            <UTooltip text="Forward">
              <UButton
                icon="i-lucide-forward"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Forward"
                @click="composeFor(item.value, 'forward')"
              />
            </UTooltip>
            <UTooltip text="Delete">
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Delete"
                @click="deleteFor(item.value)"
              />
            </UTooltip>
            <ItemActionsMenu
              domain="mail"
              :service="service"
              :entity-ref="mailRef(item.value)"
              :item="actionContext(item.value)"
              icon="i-lucide-ellipsis"
              size="xs"
            />
          </div>
        </div>

        <div v-if="isPending(item.value)" class="rounded border border-default/60">
          <MailBody :text="pending?.text" />
        </div>

        <div v-else-if="loading[item.value] && !messageFor(item.value)" class="flex items-center justify-center p-6">
          <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-dimmed" />
        </div>

        <UAlert
          v-else-if="failed[item.value]"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Could not load message"
        />

        <template v-else-if="messageFor(item.value)">
          <MailRemoteImages
            :html="messageFor(item.value)?.html"
            :sender="messageFor(item.value)?.from[0]?.address"
            :trusted="trustedImageSenders"
            :allow-remote="allowsRemote(item.value)"
            @update:allow-remote="value => setRemoteAllowed(item.value, value)"
            @trust="trust"
            @untrust="untrust"
          />
          <div class="rounded border border-default/60">
            <MailBody
              :html="messageFor(item.value)?.html"
              :text="messageFor(item.value)?.text"
              :allow-remote-images="allowsRemote(item.value)"
            />
          </div>
        </template>
      </div>
    </template>
  </UAccordion>
</template>
