<script setup lang="ts">
import { format } from 'date-fns'
import type { MailSummary } from '#layers/mail/shared/types/mail'

const props = defineProps<{
  mail: MailSummary
  service: string
}>()

const emits = defineEmits<{
  close: []
  markUnread: []
}>()

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

const recipients = computed(() => (message.value?.to ?? []).map(formatMailAddress).join(', '))
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

        <div class="min-w-0">
          <p class="font-semibold text-highlighted">
            {{ formatMailAddress(mail.from[0]) }}
          </p>
          <p class="text-muted truncate">
            {{ mail.from[0]?.address }}
          </p>
          <p v-if="recipients" class="text-muted text-sm truncate">
            To: {{ recipients }}
          </p>
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
</template>
