<script setup lang="ts">
import { format } from 'date-fns'
import type { MailSummary } from '#layers/mail/shared/types/mail'
import type { EntityRef } from '#layers/core/shared/types/entities'
import { normalizeEmail } from '#layers/core/shared/entities'

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

// r / a / f start a reply, a reply-all or a forward; not while typing in a field
defineShortcuts({
  r: () => emits('compose', 'reply'),
  a: () => emits('compose', 'replyAll'),
  f: () => emits('compose', 'forward')
})

const route = useRoute()
const router = useRouter()

const { data: message, status, error } = await useFetch(() => `/api/mail/messages/${props.mail.uid}`, {
  query: computed(() => ({ service: props.service, mailbox: props.mail.mailbox })),
  lazy: true
})

const dropdownItems = [[{
  label: 'Mark as unread',
  icon: 'i-lucide-mail',
  onSelect: () => emits('markUnread')
}]]

// Remote images (incl. tracking pixels) stay blocked until loaded explicitly for this message
const hasRemoteImages = computed(() => /<img[^>]+src\s*=\s*["']?https?:|url\(\s*["']?https?:/i.test(message.value?.html ?? ''))
const allowRemoteImages = ref(false)

const recipients = computed(() => message.value?.to ?? [])
const copies = computed(() => message.value?.cc ?? [])

const mailEntity = computed<EntityRef>(() => ({
  type: 'mail',
  service: props.service,
  id: `${props.mail.mailbox}/${props.mail.uid}`
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
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          class="-ms-1.5"
          @click="emits('close')"
        />
      </template>

      <template #right>
        <UTooltip text="Reply (r)">
          <UButton
            icon="i-lucide-reply"
            color="neutral"
            variant="ghost"
            aria-label="Reply"
            @mouseenter="emits('prefetch', 'reply')"
            @click="emits('compose', 'reply')"
          />
        </UTooltip>
        <UTooltip text="Reply all (a)">
          <UButton
            icon="i-lucide-reply-all"
            color="neutral"
            variant="ghost"
            aria-label="Reply all"
            @mouseenter="emits('prefetch', 'replyAll')"
            @click="emits('compose', 'replyAll')"
          />
        </UTooltip>
        <UTooltip text="Forward (f)">
          <UButton
            icon="i-lucide-forward"
            color="neutral"
            variant="ghost"
            aria-label="Forward"
            @mouseenter="emits('prefetch', 'forward')"
            @click="emits('compose', 'forward')"
          />
        </UTooltip>
        <UTooltip :text="permanent ? 'Delete forever' : 'Delete (#)'">
          <UButton
            icon="i-lucide-trash-2"
            :color="permanent ? 'error' : 'neutral'"
            variant="ghost"
            :aria-label="permanent ? 'Delete forever' : 'Delete'"
            @click="emits('delete')"
          />
        </UTooltip>
        <GraphLinkButton :entity="mailEntity" />
        <UDropdownMenu :items="dropdownItems">
          <UButton
            icon="i-lucide-ellipsis-vertical"
            color="neutral"
            variant="ghost"
          />
        </UDropdownMenu>
      </template>
    </UDashboardNavbar>

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
        {{ format(new Date(mail.date), 'dd MMM yyyy HH:mm') }}
      </p>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto">
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
      <div v-else-if="message" class="flex size-full flex-col">
        <UAlert
          v-if="hasRemoteImages && !allowRemoteImages"
          color="neutral"
          variant="subtle"
          icon="i-lucide-image-off"
          title="Remote images are blocked to protect your privacy."
          :actions="[{ label: 'Load images', color: 'neutral', variant: 'outline', onClick: () => { allowRemoteImages = true } }]"
          orientation="horizontal"
          class="rounded-none"
        />
        <MailBody
          :html="message.html"
          :text="message.text"
          :allow-remote-images="allowRemoteImages"
          class="flex-1"
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
