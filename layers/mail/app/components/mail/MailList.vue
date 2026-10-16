<script setup lang="ts">
import { format, isToday } from 'date-fns'
import type { MailSummary } from '#layers/mail/shared/types/mail'
import { highlightToHtml } from '#layers/mail/shared/mail-highlight'

const props = defineProps<{
  mails: MailSummary[]
  /** Show the folder of each hit, e.g. when searching across all folders */
  showMailbox?: boolean
  /** Display names by `service/mailbox`, resolved by the page */
  mailboxNames?: Record<string, string>
}>()

const mailsRefs = ref<Record<string, Element | null>>({})

const selectedMail = defineModel<MailSummary | null>()

const selectedKey = computed(() => selectedMail.value ? mailKey(selectedMail.value) : undefined)

const mailboxName = (mail: MailSummary) => props.mailboxNames?.[`${mail.service}/${mail.mailbox}`] ?? mail.mailbox

watch(selectedMail, () => {
  if (!selectedKey.value) {
    return
  }
  const ref = mailsRefs.value[selectedKey.value]
  if (ref) {
    ref.scrollIntoView({ block: 'nearest' })
  }
})

defineShortcuts({
  arrowdown: () => {
    const index = props.mails.findIndex(mail => mailKey(mail) === selectedKey.value)

    if (index === -1) {
      selectedMail.value = props.mails[0]
    } else if (index < props.mails.length - 1) {
      selectedMail.value = props.mails[index + 1]
    }
  },
  arrowup: () => {
    const index = props.mails.findIndex(mail => mailKey(mail) === selectedKey.value)

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
      :key="mailKey(mail)"
      :ref="(el: unknown) => { mailsRefs[mailKey(mail)] = el as Element | null }"
    >
      <div
        class="p-4 sm:px-6 text-sm cursor-pointer border-l-2 transition-colors"
        :class="[
          mail.unread ? 'text-highlighted' : 'text-toned',
          selectedMail && selectedKey === mailKey(mail)
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

          <div class="flex shrink-0 items-center gap-2">
            <span v-if="showMailbox" class="rounded bg-elevated px-1.5 py-0.5 text-xs font-normal text-dimmed">
              {{ mailboxName(mail) }}
            </span>
            <span>{{ isToday(new Date(mail.date)) ? format(new Date(mail.date), 'HH:mm') : format(new Date(mail.date), 'dd MMM') }}</span>
          </div>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -- highlightToHtml escapes the mail content -->
        <p class="truncate" :class="[mail.unread && 'font-semibold']" v-html="highlightToHtml(mail.subjectHighlight ?? mail.subject) || '(no subject)'" />
        <!-- eslint-disable-next-line vue/no-v-html -- highlightToHtml escapes the mail content -->
        <p v-if="mail.snippet" class="text-dimmed line-clamp-2" v-html="highlightToHtml(mail.snippet)" />
      </div>
    </div>

    <slot name="more" />
  </div>
</template>
