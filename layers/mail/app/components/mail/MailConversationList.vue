<script setup lang="ts">
import { format, isToday } from 'date-fns'
import type { MailAddress, MailConversation } from '#layers/mail/shared/types/mail'
import { conversationParticipantLabel } from '#layers/mail/shared/mail-thread'
import { highlightToHtml } from '#layers/mail/shared/mail-highlight'

const props = defineProps<{
  conversations: MailConversation[]
  selectedKey?: string
  /** The account's own address, shown as "me" */
  ownAddress?: string
}>()

const emits = defineEmits<{
  select: [key: string]
  prefetch: [key: string]
}>()

const participantNames = (participants: MailAddress[]) =>
  participants.map(address => conversationParticipantLabel(address, props.ownAddress)).join(', ')
</script>

<template>
  <div class="overflow-y-auto divide-y divide-default">
    <div
      v-for="conversation in conversations"
      :key="conversation.key"
      class="p-4 sm:px-6 text-sm cursor-pointer border-l-2 transition-colors"
      :class="[
        conversation.unread ? 'text-highlighted' : 'text-toned',
        selectedKey === conversation.key
          ? 'border-primary bg-primary/10'
          : 'border-bg hover:border-primary hover:bg-primary/5'
      ]"
      @mouseenter="emits('prefetch', conversation.key)"
      @click="emits('select', conversation.key)"
    >
      <div class="flex items-center justify-between gap-2" :class="[conversation.unread && 'font-semibold']">
        <div class="flex items-center gap-3 min-w-0">
          <span class="truncate">{{ participantNames(conversation.participants) || 'Unknown sender' }}</span>

          <UChip v-if="conversation.unread" />
          <UBadge
            v-if="conversation.count > 1"
            :label="conversation.count"
            variant="subtle"
            color="neutral"
            size="sm"
          />
        </div>

        <span class="shrink-0">
          {{ isToday(new Date(conversation.latest.date)) ? format(new Date(conversation.latest.date), 'HH:mm') : format(new Date(conversation.latest.date), 'dd MMM') }}
        </span>
      </div>
      <!-- eslint-disable-next-line vue/no-v-html -- highlightToHtml escapes the mail content -->
      <p class="truncate" :class="[conversation.unread && 'font-semibold']" v-html="highlightToHtml(conversation.latest.subjectHighlight ?? conversation.subject) || '(no subject)'" />
      <!-- eslint-disable-next-line vue/no-v-html -- highlightToHtml escapes the mail content -->
      <p v-if="conversation.latest.snippet" class="text-dimmed line-clamp-2" v-html="highlightToHtml(conversation.latest.snippet)" />
    </div>

    <slot name="more" />
  </div>
</template>
