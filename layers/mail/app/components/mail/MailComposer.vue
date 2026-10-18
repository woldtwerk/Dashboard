<script setup lang="ts">
import { breakpointsTailwind } from '@vueuse/core'
import type { OutgoingMail } from '#layers/mail/shared/mail-compose'
import type { MailComposeDraft } from '#layers/mail/app/utils/mail-compose'

const props = defineProps<{
  open: boolean
  /** The draft to start from; the composer never mutates it */
  mail: OutgoingMail
  /** Where unsent text is kept, per compose; nothing is kept without it */
  draftKey?: string
  title?: string
  sending?: boolean
}>()

const emits = defineEmits<{
  'update:open': [open: boolean]
  'send': [mail: OutgoingMail]
  'discard': []
}>()

// A reload restores what was typed; the prefill is the fallback
const stored = props.draftKey ? readMailDraft<MailComposeDraft>(props.draftKey) : undefined

const to = ref<string[]>(stored?.to ?? props.mail.to.map(formatMailAddressTag))
const cc = ref<string[]>(stored?.cc ?? props.mail.cc.map(formatMailAddressTag))
const bcc = ref<string[]>(stored?.bcc ?? props.mail.bcc.map(formatMailAddressTag))
const subject = ref(stored?.subject ?? props.mail.subject)
const text = ref(stored?.text ?? props.mail.text)

const draft = computed<MailComposeDraft>(() => ({ to: to.value, cc: cc.value, bcc: bcc.value, subject: subject.value, text: text.value }))

watch(draft, (value) => {
  if (props.draftKey) {
    writeMailDraft(props.draftKey, value)
  }
}, { deep: true })

const invalid = computed(() => [
  ...invalidMailAddresses(to.value),
  ...invalidMailAddresses(cc.value),
  ...invalidMailAddresses(bcc.value)
])

const recipientCount = computed(() => to.value.length + cc.value.length + bcc.value.length)
const canSend = computed(() => recipientCount.value > 0 && !invalid.value.length)

function send() {
  if (!canSend.value || props.sending) {
    return
  }
  emits('send', toOutgoingMail(draft.value))
}

function discard() {
  if (props.draftKey) {
    clearMailDraft(props.draftKey)
  }
  emits('discard')
}

// Ctrl/Cmd+Enter sends even while the caret is in a field; `meta` maps to Ctrl off macOS
defineShortcuts({
  meta_enter: { handler: send, usingInput: true }
})

const isMobile = useBreakpoints(breakpointsTailwind).smaller('lg')

// Full screen on a phone, a panel on a desktop
const slideoverUi = computed(() => isMobile.value
  ? { content: 'w-screen max-w-none h-dvh rounded-none' }
  : { content: 'sm:max-w-2xl' })
</script>

<template>
  <USlideover
    :open="open"
    :title="title ?? 'New mail'"
    :side="isMobile ? 'bottom' : 'right'"
    :ui="slideoverUi"
    @update:open="value => emits('update:open', value)"
  >
    <template #body>
      <div class="flex h-full flex-col gap-4">
        <UFormField label="To">
          <UInputTags
            v-model="to"
            :add-on-blur="true"
            placeholder="alice@example.com"
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Cc">
            <UInputTags
              v-model="cc"
              :add-on-blur="true"
              placeholder="Cc"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Bcc">
            <UInputTags
              v-model="bcc"
              :add-on-blur="true"
              placeholder="Bcc"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="Subject">
          <UInput v-model="subject" placeholder="Subject" class="w-full" />
        </UFormField>

        <UFormField label="Message" class="flex min-h-0 flex-1 flex-col">
          <UTextarea
            v-model="text"
            :rows="12"
            autoresize
            placeholder="Write your message..."
            class="w-full"
          />
        </UFormField>

        <UAlert
          v-if="invalid.length"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Check the addresses"
          :description="invalid.join(', ')"
        />
      </div>
    </template>

    <template #footer>
      <UButton
        label="Discard"
        color="neutral"
        variant="ghost"
        @click="discard"
      />
      <UButton
        type="button"
        label="Send"
        icon="i-lucide-send"
        :loading="sending"
        :disabled="!canSend"
        @click="send"
      />
    </template>
  </USlideover>
</template>
