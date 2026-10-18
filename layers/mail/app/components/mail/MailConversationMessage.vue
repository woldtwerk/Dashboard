<script setup lang="ts">
import { format } from 'date-fns'
import type { MailSummary } from '#layers/mail/shared/types/mail'
import { splitQuoted } from '#layers/mail/shared/mail-thread'

const props = defineProps<{
  mail: MailSummary
  service: string
  /** Sent by the account itself; the bubble is aligned to the right */
  own?: boolean
}>()

const emits = defineEmits<{
  open: []
}>()

const { data: message, status } = await useFetch(() => `/api/mail/messages/${props.mail.uid}`, {
  query: computed(() => ({ service: props.service, mailbox: props.mail.mailbox })),
  lazy: true
})

const quoted = computed(() => splitQuoted(message.value?.text))
const showQuoted = ref(false)
const sender = computed(() => formatMailAddress(props.mail.from[0]))
</script>

<template>
  <article class="flex max-w-full flex-col gap-1" :class="own ? 'items-end' : 'items-start'">
    <button
      type="button"
      class="flex max-w-full items-center gap-2 px-1 text-xs text-muted transition-colors hover:text-highlighted"
      @click="emits('open')"
    >
      <span class="font-medium text-toned">{{ sender }}</span>
      <span>{{ format(new Date(mail.date), 'dd MMM yyyy HH:mm') }}</span>
    </button>

    <div class="max-w-[85%] rounded-lg px-3 py-2 text-sm" :class="own ? 'bg-primary/10' : 'bg-elevated'">
      <div v-if="status === 'pending'" class="flex items-center justify-center p-2">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-dimmed" />
      </div>

      <template v-else-if="message">
        <p v-if="message.text" class="whitespace-pre-wrap">
          {{ quoted.body }}
        </p>

        <button
          v-if="quoted.quoted"
          type="button"
          class="mt-2 text-xs text-primary hover:underline"
          @click="showQuoted = !showQuoted"
        >
          {{ showQuoted ? 'Hide quoted text' : 'Show quoted text' }}
        </button>
        <p v-if="showQuoted && quoted.quoted" class="mt-2 whitespace-pre-wrap border-s-2 border-default ps-2 text-dimmed">
          {{ quoted.quoted }}
        </p>

        <div v-if="!message.text && message.html" class="h-72 w-full overflow-hidden rounded">
          <MailBody :html="message.html" />
        </div>

        <p v-if="!message.text && !message.html" class="text-dimmed">
          (no content)
        </p>
      </template>
    </div>
  </article>
</template>
