<script setup lang="ts">
import { useInfiniteScroll } from '@vueuse/core'
import type { ContextMenuItem } from '@nuxt/ui'
import type { MailAddress, MailConversation, MailSummary } from '#layers/mail/shared/types/mail'
import { conversationKind, conversationParticipantLabel, streamLabel } from '#layers/mail/shared/mail-thread'
import { highlightToHtml } from '#layers/mail/shared/mail-highlight'
import { itemActionMenuItems } from '#layers/core/app/utils/item-actions'
import { adjacentListKey } from '#layers/mail/app/utils/mail-list-navigation'
import { mailContextMenuItems, mailItemContext } from '#layers/mail/app/utils/mail-context-menu'
import { formatMailListDate } from '#layers/mail/app/utils/mail-date'

const props = defineProps<{
  conversations: MailConversation[]
  selectedKey?: string
  /** The account the list belongs to, for other layers' item actions */
  service: string
  /** The account's own address, shown as "me" */
  ownAddress?: string
  /** A further page is on its way */
  loadingMore?: boolean
  /** The last page was short; there is nothing more to load */
  done?: boolean
  /** Whether deleting this mail removes it for good, e.g. in the trash */
  isPermanent?: (mail: MailSummary) => boolean
}>()

const emits = defineEmits<{
  select: [key: string]
  prefetch: [key: string]
  loadMore: []
  compose: [mode: 'reply' | 'replyAll' | 'forward', mail: MailSummary]
  toggleUnread: [mail: MailSummary]
  delete: [mail: MailSummary]
}>()

const scroller = ref<HTMLElement | null>(null)
const conversationRefs = ref<Record<string, Element | null>>({})

// One zone for the whole list, resolved once; the rows only format with it
const zone = useTimeZone()

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

// Keep the selected row visible, as the mails list does
watch(() => props.selectedKey, (key) => {
  if (!key) {
    return
  }
  conversationRefs.value[key]?.scrollIntoView({ block: 'nearest' })
})

function move(delta: 1 | -1) {
  const next = adjacentListKey(props.conversations.map(conversation => conversation.key), props.selectedKey, delta)

  if (next === 'loadMore') {
    emits('loadMore')
    return
  }
  if (next === null) {
    return
  }
  emits('prefetch', next)
  emits('select', next)
}

defineShortcuts({
  arrowdown: () => move(1),
  arrowup: () => move(-1)
})

/** The context menu of one conversation, built lazily from its latest mail */
function contextItems(conversation: MailConversation): ContextMenuItem[][] {
  const mail = conversation.latest
  const groups = mailContextMenuItems(
    mail,
    {
      permanent: props.isPermanent?.(mail) ?? false,
      // A conversation with several mails has no single mail to delete
      deletable: conversation.count === 1,
      // r/a/f only work on the open mail and # deletes the selected mail,
      // neither of which this view has
      kbds: false
    },
    {
      open: () => emits('select', conversation.key),
      compose: mode => emits('compose', mode, mail),
      toggleUnread: () => emits('toggleUnread', mail),
      delete: () => emits('delete', mail)
    }
  )

  return itemActionMenuItems('mail', mailItemContext(mail, props.service), groups)
}
</script>

<template>
  <div ref="scroller" class="overflow-y-auto">
    <TransitionGroup name="conversation" tag="div" class="relative">
      <div
        v-for="conversation in conversations"
        :key="conversation.key"
        :ref="(el: unknown) => { conversationRefs[conversation.key] = el as Element | null }"
        class="border-b border-default bg-default"
      >
        <UContextMenu :items="contextItems(conversation)">
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
                {{ formatMailListDate(conversation.latest.date, zone) }}
              </span>
            </div>
            <!-- eslint-disable-next-line vue/no-v-html -- highlightToHtml escapes the mail content -->
            <p class="truncate" :class="[conversation.unread && 'font-semibold']" v-html="highlightToHtml(conversation.latest.subjectHighlight ?? conversation.subject) || '(no subject)'" />
            <!-- eslint-disable-next-line vue/no-v-html -- highlightToHtml escapes the mail content -->
            <p v-if="conversation.latest.snippet" class="text-dimmed line-clamp-2" v-html="highlightToHtml(conversation.latest.snippet)" />
          </div>
        </UContextMenu>
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
