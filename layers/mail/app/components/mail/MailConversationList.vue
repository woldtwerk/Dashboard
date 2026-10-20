<script setup lang="ts">
import { useInfiniteScroll } from '@vueuse/core'
import type { ContextMenuItem } from '@nuxt/ui'
import type { MailAddress, MailConversation, MailSummary } from '#layers/mail/shared/types/mail'
import { conversationKind, conversationParticipantLabel, streamLabel } from '#layers/mail/shared/mail-thread'
import { highlightToHtml } from '#layers/mail/shared/mail-highlight'
import { itemActionMenuItems } from '#layers/core/app/utils/item-actions'
import { adjacentListKey } from '#layers/mail/app/utils/mail-list-navigation'
import { mailBatchContextMenuItems, mailContextMenuItems, mailItemContext } from '#layers/mail/app/utils/mail-context-menu'
import { labelToggleState, mailLabelChoices } from '#layers/mail/app/utils/mail-labels'
import type { MailBatchAction } from '#layers/mail/app/utils/mail-batch'
import { contextTargets, rangeSelection, toggleSelection } from '#layers/mail/app/utils/mail-selection'
import { formatMailListDate } from '#layers/mail/app/utils/mail-date'

const props = defineProps<{
  conversations: MailConversation[]
  selectedKey?: string
  /** Ordered conversation keys the page keeps in the URL */
  selection?: string[]
  /** The account the list belongs to, for other layers' item actions */
  service: string
  /** The account's own address, shown as "me" */
  ownAddress?: string
  /** The account's label names, for the context menu's label submenu */
  labels?: string[]
  /** The label that marks a mail as done */
  doneLabel?: string
  /** A further page is on its way */
  loadingMore?: boolean
  /** The last page was short; there is nothing more to load */
  done?: boolean
  /** Whether deleting this mail removes it for good, e.g. in the trash */
  isPermanent?: (mail: MailSummary) => boolean
  /** The attachment preview is open; arrow keys belong to it */
  shortcutsDisabled?: boolean
}>()

const emits = defineEmits<{
  select: [key: string]
  prefetch: [key: string]
  loadMore: []
  compose: [mode: 'reply' | 'replyAll' | 'forward', mail: MailSummary]
  toggleUnread: [mail: MailSummary]
  /** Done acts on every mail of the conversation, so the page gets its key */
  toggleDone: [key: string]
  label: [key: string, label: string, on: boolean]
  delete: [mail: MailSummary]
  /** One of the bulk actions for the whole selection */
  batch: [action: MailBatchAction]
  batchLabel: [label: string, on: boolean]
  /** The page writes the new selection to the URL */
  updateSelection: [keys: string[]]
}>()

const scroller = ref<HTMLElement | null>(null)
const conversationRefs = ref<Record<string, Element | null>>({})

/** The conversation a shift-click range grows from; UI state, the selection itself is URL state */
const anchor = ref<string | undefined>()

const selection = computed(() => props.selection ?? [])

/** A conversation with several mails has no single mail to delete */
const deletableSelection = computed(() => props.conversations.filter(conversation =>
  selection.value.includes(conversation.key) && conversation.count === 1
))

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
  if (props.shortcutsDisabled) {
    return
  }

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

const isSelected = (conversation: MailConversation) => selection.value.includes(conversation.key)

/**
 * A plain click still opens one conversation. Ctrl/⌘-click toggles it in the
 * selection and Shift-click replaces the selection with the range from the last
 * anchor.
 */
function selectConversation(event: MouseEvent, conversation: MailConversation) {
  if (event.shiftKey) {
    emits('updateSelection', rangeSelection(props.conversations.map(item => item.key), anchor.value, conversation.key))
    return
  }

  if (event.metaKey || event.ctrlKey) {
    emits('updateSelection', toggleSelection(selection.value, conversation.key))
    anchor.value = conversation.key
    return
  }

  anchor.value = conversation.key
  emits('select', conversation.key)
}

defineShortcuts({
  arrowdown: () => move(1),
  arrowup: () => move(-1),
  escape: () => {
    if (props.shortcutsDisabled) {
      return
    }
    if (selection.value.length) {
      emits('updateSelection', [])
    }
  }
})

/** The context menu of one conversation, built lazily from its latest mail */
function contextItems(conversation: MailConversation): ContextMenuItem[][] {
  const mail = conversation.latest
  const targets = contextTargets(selection.value, conversation.key)
  const targetConversations = targets
    .map(key => props.conversations.find(item => item.key === key))
    .filter((item): item is MailConversation => !!item)

  const doneLabel = props.doneLabel ?? 'Done'
  const latest = targetConversations.map(item => item.latest)

  if (targetConversations.length > 1) {
    const groups = mailBatchContextMenuItems(
      `${targetConversations.length} conversations`,
      {
        // Delete is permanent when every deletable conversation sits in the trash
        permanent: targetConversations.every(item => props.isPermanent?.(item.latest) ?? false),
        deletable: targetConversations.some(item => item.count === 1),
        done: labelToggleState(latest, doneLabel),
        doneLabel,
        labels: mailLabelChoices(props.labels ?? [], latest)
      },
      {
        markRead: () => emits('batch', 'read'),
        markUnread: () => emits('batch', 'unread'),
        toggleDone: () => emits('batch', 'done'),
        setLabel: (label, on) => emits('batchLabel', label, on),
        delete: () => emits('batch', 'delete')
      }
    )

    return itemActionMenuItems(
      'mail',
      targetConversations.map(item => mailItemContext(item.latest, props.service)),
      groups
    )
  }

  const groups = mailContextMenuItems(
    mail,
    {
      permanent: props.isPermanent?.(mail) ?? false,
      // A conversation with several mails has no single mail to delete
      deletable: conversation.count === 1,
      done: labelToggleState([mail], doneLabel),
      doneLabel,
      labels: mailLabelChoices(props.labels ?? [], [mail])
    },
    {
      open: () => emits('select', conversation.key),
      compose: mode => emits('compose', mode, mail),
      toggleUnread: () => emits('toggleUnread', mail),
      toggleDone: () => emits('toggleDone', conversation.key),
      setLabel: (label, on) => emits('label', conversation.key, label, on),
      delete: () => emits('delete', mail)
    }
  )

  return itemActionMenuItems('mail', mailItemContext(mail, props.service), groups)
}
</script>

<template>
  <div ref="scroller" class="overflow-y-auto">
    <div
      v-if="selection.length"
      class="sticky top-0 z-10 flex items-center gap-1.5 border-b border-default bg-default/95 px-4 py-2 backdrop-blur sm:px-6"
    >
      <span class="text-sm font-medium">{{ selection.length }} selected</span>
      <span class="text-dimmed">·</span>
      <UButton
        label="Read"
        icon="i-lucide-mail-open"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="emits('batch', 'read')"
      />
      <UButton
        label="Unread"
        icon="i-lucide-mail"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="emits('batch', 'unread')"
      />
      <UButton
        label="Done"
        icon="i-lucide-check"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="emits('batch', 'done')"
      />
      <UButton
        label="Delete"
        icon="i-lucide-trash-2"
        color="neutral"
        variant="ghost"
        size="xs"
        :disabled="!deletableSelection.length"
        @click="emits('batch', 'delete')"
      />
      <UButton
        label="Clear"
        color="neutral"
        variant="link"
        size="xs"
        @click="emits('updateSelection', [])"
      />
    </div>

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
              isSelected(conversation)
                ? 'border-primary bg-elevated ring-1 ring-inset ring-primary/40'
                : selectedKey === conversation.key
                  ? 'border-primary bg-primary/10'
                  : 'border-bg hover:border-primary hover:bg-primary/5'
            ]"
            @mouseenter="emits('prefetch', conversation.key)"
            @click="selectConversation($event, conversation)"
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
                <MailLabelBadges :labels="conversation.latest.labels" :done-label="doneLabel" />
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
