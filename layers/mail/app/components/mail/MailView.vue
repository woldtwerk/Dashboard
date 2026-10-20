<script setup lang="ts">
import type { MailSummary } from '#layers/mail/shared/types/mail'
import type { EntityRef } from '#layers/core/shared/types/entities'
import { normalizeEmail, entityKey } from '#layers/core/shared/entities'
import { isTrustedImageSender } from '#layers/mail/shared/mail-images'
import { formatMailFullDate } from '#layers/mail/app/utils/mail-date'

const props = defineProps<{
  mail: MailSummary
  service: string
  /** The mail already sits in the trash, so deleting removes it for good */
  permanent?: boolean
}>()

const emits = defineEmits<{
  close: []
  markUnread: []
  delete: []
  compose: [mode: 'reply' | 'replyAll' | 'forward']
  /** Warm the message the composer will need */
  prefetch: [mode: 'reply' | 'replyAll' | 'forward']
}>()

const route = useRoute()
const router = useRouter()

// The zone the header renders the mail's date in, resolved once for the view
const zone = useTimeZone()

// The reader, the composer and the list's hover prefetch share one request per mail
const { data: message, status, error } = useMailMessage(() => props.mail, () => props.service)

const dropdownItems = [[{
  label: 'Mark as unread',
  icon: 'i-lucide-mail',
  onSelect: () => emits('markUnread')
}]]

// Remote images (incl. tracking pixels) stay blocked until loaded explicitly for this
// message, or automatically for a sender the user trusts in the mail settings
const allowRemoteImages = ref(false)
const { trustedImageSenders, trust, untrust } = useTrustedImageSenders()
const senderAddress = computed(() => normalizeEmail((message.value?.from[0] ?? props.mail.from[0])?.address))
const senderTrusted = computed(() => isTrustedImageSender(senderAddress.value, trustedImageSenders.value))
const remoteImagesAllowed = computed(() => allowRemoteImages.value || senderTrusted.value)

const recipients = computed(() => message.value?.to ?? [])
const copies = computed(() => message.value?.cc ?? [])

const mailEntity = computed<EntityRef>(() => ({
  type: 'mail',
  service: props.service,
  id: `${props.mail.mailbox}/${props.mail.uid}`
}))

const mailRef = computed(() => entityKey(mailEntity.value))

// What other layers' item actions may read; the mail layer knows none of them
const itemContext = computed<Record<string, unknown>>(() => ({
  from: message.value?.from ?? props.mail.from,
  to: message.value?.to ?? props.mail.to,
  subject: props.mail.subject,
  mailbox: props.mail.mailbox,
  listId: props.mail.listId,
  snippet: props.mail.snippet
}))

// The person panel lives in the URL (`?person=<email>`), so a link can open it directly
function updateQuery(patch: Record<string, string | null>) {
  router.replace({ query: Object.fromEntries(Object.entries({ ...route.query, ...patch }).filter(([, value]) => value)) })
}

const personEmail = computed(() => typeof route.query.person === 'string' ? route.query.person : undefined)
const isPersonOpen = computed({
  get: () => !!personEmail.value,
  set: (open: boolean) => {
    if (!open) {
      updateQuery({ person: null })
    }
  }
})

function openPerson(address?: string) {
  const email = normalizeEmail(address)
  if (email) {
    updateQuery({ person: email })
  }
}
</script>

<template>
  <UDashboardPanel id="mail-2">
    <UDashboardNavbar :title="mail.subject || '(no subject)'" :toggle="false">
      <template #leading>
        <UTooltip text="Close">
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            class="-ms-1.5"
            aria-label="Close"
            @click="emits('close')"
          />
        </UTooltip>
      </template>

      <template #right>
        <UTooltip text="Reply" :kbds="['r']">
          <UButton
            icon="i-lucide-reply"
            color="neutral"
            variant="ghost"
            aria-label="Reply"
            @mouseenter="emits('prefetch', 'reply')"
            @click="emits('compose', 'reply')"
          />
        </UTooltip>
        <UTooltip text="Reply all" :kbds="['a']">
          <UButton
            icon="i-lucide-reply-all"
            color="neutral"
            variant="ghost"
            aria-label="Reply all"
            @mouseenter="emits('prefetch', 'replyAll')"
            @click="emits('compose', 'replyAll')"
          />
        </UTooltip>
        <UTooltip text="Forward" :kbds="['f']">
          <UButton
            icon="i-lucide-forward"
            color="neutral"
            variant="ghost"
            aria-label="Forward"
            @mouseenter="emits('prefetch', 'forward')"
            @click="emits('compose', 'forward')"
          />
        </UTooltip>
        <UTooltip :text="permanent ? 'Delete forever' : 'Delete'" :kbds="['#']">
          <UButton
            icon="i-lucide-trash-2"
            :color="permanent ? 'error' : 'neutral'"
            variant="ghost"
            :aria-label="permanent ? 'Delete forever' : 'Delete'"
            @click="emits('delete')"
          />
        </UTooltip>
        <GraphLinkButton :entity="mailEntity" />
        <ItemActionsMenu
          domain="mail"
          :service="service"
          :entity-ref="mailRef"
          :item="itemContext"
          :items="dropdownItems"
          icon="i-lucide-ellipsis-vertical"
        />
      </template>
    </UDashboardNavbar>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="flex flex-col sm:flex-row justify-between gap-1 p-4 sm:px-6 border-b border-default">
        <div class="flex items-start gap-4 sm:my-1.5 min-w-0">
          <UAvatar :alt="formatMailAddress(mail.from[0])" size="3xl" />

          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-1">
              <button
                v-for="address in mail.from"
                :key="address.address"
                type="button"
                class="rounded-full bg-elevated px-2 py-0.5 text-sm font-semibold text-highlighted transition-colors hover:bg-accented"
                @click="openPerson(address.address)"
              >
                {{ formatMailAddress(address) }}
              </button>
            </div>
            <div v-if="recipients.length" class="flex flex-wrap items-center gap-1 text-sm text-muted">
              <span>To:</span>
              <button
                v-for="address in recipients"
                :key="address.address"
                type="button"
                class="rounded-full bg-elevated px-2 py-0.5 text-xs transition-colors hover:bg-accented"
                @click="openPerson(address.address)"
              >
                {{ formatMailAddress(address) }}
              </button>
            </div>
            <div v-if="copies.length" class="flex flex-wrap items-center gap-1 text-sm text-muted">
              <span>Cc:</span>
              <button
                v-for="address in copies"
                :key="address.address"
                type="button"
                class="rounded-full bg-elevated px-2 py-0.5 text-xs transition-colors hover:bg-accented"
                @click="openPerson(address.address)"
              >
                {{ formatMailAddress(address) }}
              </button>
            </div>
          </div>
        </div>

        <p class="max-sm:pl-16 text-muted text-sm sm:mt-2 shrink-0">
          {{ formatMailFullDate(mail.date, zone) }}
        </p>
      </div>

      <div v-if="status === 'pending'" class="flex items-center justify-center p-8">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-dimmed" />
      </div>
      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Could not load message"
        :description="error.statusMessage || error.message"
        class="m-4"
      />
      <div v-else-if="message">
        <MailRemoteImages
          v-model:allow-remote="allowRemoteImages"
          :html="message.html"
          :sender="message.from[0]?.address ?? mail.from[0]?.address"
          :trusted="trustedImageSenders"
          @trust="trust"
          @untrust="untrust"
        />
        <MailBody
          :html="message.html"
          :text="message.text"
          :allow-remote-images="remoteImagesAllowed"
        />
      </div>
    </div>
  </UDashboardPanel>

  <USlideover v-model:open="isPersonOpen" :title="personEmail ?? 'Person'">
    <template #body>
      <PersonDetails v-if="personEmail" :email="personEmail" />
    </template>
  </USlideover>
</template>
