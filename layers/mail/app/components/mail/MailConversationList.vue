<script setup lang="ts">
import { useInfiniteScroll } from '@vueuse/core'
import { format, isToday } from 'date-fns'
import type { MailAddress, MailConversation } from '#layers/mail/shared/types/mail'
import { conversationKind, conversationParticipantLabel, streamLabel } from '#layers/mail/shared/mail-thread'
import { highlightToHtml } from '#layers/mail/shared/mail-highlight'

const props = defineProps<{
  conversations: MailConversation[]
  selectedKey?: string
  /** The account's own address, shown as "me" */
  ownAddress?: string
  /** A further page is on its way */
  loadingMore?: boolean
  /** The last page was short; there is nothing more to load */
  done?: boolean
}>()

const emits = defineEmits<{
  select: [key: string]
  prefetch: [key: string]
  loadMore: []
}>()

const scroller = ref<HTMLElement | null>(null)

const participantNames = (participants: MailAddress[]) =>
  participants.map(address => conversationParticipantLabel(address, props.ownAddress)).join(', ')

/** A stream (mailing list or bulk sender) is labelled by its list, not its participants */
const isStream = (conversation: MailConversation) => conversationKind(conversation) === 'stream'

const streamIcon = (key: string) => key.startsWith('list:') ? 'i-lucide-newspaper' : 'i-lucide-mail-plus'

const conversationLabel = (conversation: MailConversation) =>
  isStream(conversation)
    ? streamLabel(conversation.latest)
    : participantNames(conversation.participants) || 'Unknown sender'

function scrollToTop() {
  if (scroller.value) {
    scroller.value.scrollTop = 0
  }
}

defineExpose({ scrollToTop })

useInfiniteScroll(scroller, () => emits('loadMore'), {
  distance: 400,
  canLoadMore: () => !props.loadingMore && !props.done
})
</script>

<template>
  <div ref="scroller" class="overflow-y-auto">
    <TransitionGroup name="conversation" tag="div" class="relative">
      <div
        v-for="conversation in conversations"
        :key="conversation.key"
        class="border-b border-default bg-default"
      >
        <div
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
              <UIcon
                v-if="isStream(conversation)"
                :name="streamIcon(conversation.key)"
                class="size-4 shrink-0 text-dimmed"
              />
              <span class="truncate">{{ conversationLabel(conversation) }}</span>

              <UChip v-if="conversation.unread" />
              <UBadge
                v-if="conversation.count > 1 || isStream(conversation)"
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
      </div>
    </TransitionGroup>

    <slot name="more" />

    <div v-if="loadingMore" class="flex items-center justify-center p-4">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-dimmed" />
    </div>
    <p v-else-if="done && conversations.length" class="p-4 text-center text-xs text-dimmed">
      No more conversations
    </p>
  </div>
</template>

<style scoped>
.conversation-enter-active {
  transition: opacity 300ms ease;
}

.conversation-enter-from {
  opacity: 0;
}

.conversation-leave-active {
  transition: opacity 300ms ease;
  position: absolute;
  left: 0;
  right: 0;
}

.conversation-leave-to {
  opacity: 0;
}

.conversation-move {
  transition: transform 300ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .conversation-enter-active,
  .conversation-leave-active,
  .conversation-move {
    transition: none;
  }
}
</style>
