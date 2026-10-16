<script setup lang="ts">
import { format, isToday } from 'date-fns'
import type { MailSummary } from '#layers/mail/shared/types/mail'

const props = defineProps<{
  mails: MailSummary[]
}>()

const mailsRefs = ref<Record<number, Element | null>>({})

const selectedMail = defineModel<MailSummary | null>()

watch(selectedMail, () => {
  if (!selectedMail.value) {
    return
  }
  const ref = mailsRefs.value[selectedMail.value.uid]
  if (ref) {
    ref.scrollIntoView({ block: 'nearest' })
  }
})

defineShortcuts({
  arrowdown: () => {
    const index = props.mails.findIndex(mail => mail.uid === selectedMail.value?.uid)

    if (index === -1) {
      selectedMail.value = props.mails[0]
    } else if (index < props.mails.length - 1) {
      selectedMail.value = props.mails[index + 1]
    }
  },
  arrowup: () => {
    const index = props.mails.findIndex(mail => mail.uid === selectedMail.value?.uid)

    if (index === -1) {
      selectedMail.value = props.mails[props.mails.length - 1]
    } else if (index > 0) {
      selectedMail.value = props.mails[index - 1]
    }
  }
})
</script>

<template>
  <div class="overflow-y-auto divide-y divide-default">
    <div
      v-for="mail in mails"
      :key="mail.uid"
      :ref="(el: unknown) => { mailsRefs[mail.uid] = el as Element | null }"
    >
      <div
        class="p-4 sm:px-6 text-sm cursor-pointer border-l-2 transition-colors"
        :class="[
          mail.unread ? 'text-highlighted' : 'text-toned',
          selectedMail && selectedMail.uid === mail.uid
            ? 'border-primary bg-primary/10'
            : 'border-bg hover:border-primary hover:bg-primary/5'
        ]"
        @click="selectedMail = mail"
      >
        <div class="flex items-center justify-between gap-2" :class="[mail.unread && 'font-semibold']">
          <div class="flex items-center gap-3 min-w-0">
            <span class="truncate">{{ formatMailAddress(mail.from[0]) }}</span>

            <UChip v-if="mail.unread" />
            <UIcon v-if="mail.flagged" name="i-lucide-star" class="size-3.5 shrink-0 text-warning" />
          </div>

          <span class="shrink-0">{{ isToday(new Date(mail.date)) ? format(new Date(mail.date), 'HH:mm') : format(new Date(mail.date), 'dd MMM') }}</span>
        </div>
        <p class="truncate" :class="[mail.unread && 'font-semibold']">
          {{ mail.subject || '(no subject)' }}
        </p>
        <p v-if="mail.snippet" class="text-dimmed line-clamp-2">
          {{ mail.snippet }}
        </p>
      </div>
    </div>
  </div>
</template>
