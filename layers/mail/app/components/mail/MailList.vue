<script setup lang="ts">
import { useInfiniteScroll } from '@vueuse/core'
import type { ContextMenuItem } from '@nuxt/ui'
import type { MailSummary } from '#layers/mail/shared/types/mail'
import { highlightToHtml } from '#layers/mail/shared/mail-highlight'
import { itemActionMenuItems } from '#layers/core/app/utils/item-actions'
import { adjacentListKey, neighbourListKeys } from '#layers/mail/app/utils/mail-list-navigation'
import { mailBatchContextMenuItems, mailContextMenuItems, mailItemContext } from '#layers/mail/app/utils/mail-context-menu'
import { labelToggleState, mailLabelChoices } from '#layers/mail/app/utils/mail-labels'
import type { MailBatchAction } from '#layers/mail/app/utils/mail-batch'
import { contextTargets, isMailSelected, mailSelectionKey, rangeSelection, toggleSelection } from '#layers/mail/app/utils/mail-selection'
import { formatMailListDate } from '#layers/mail/app/utils/mail-date'

const props = defineProps<{
  mails: MailSummary[]
  /** The account the list belongs to, for other layers' item actions */
  service: string
  /** Ordered mail keys the page keeps in the URL */
  selection?: string[]
  /** Show the folder of each hit, e.g. when searching across all folders */
  showMailbox?: boolean
  /** Display names by `service/mailbox`, resolved by the page */
  mailboxNames?: Record<string, string>
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
}>()

const emits = defineEmits<{
  loadMore: []
  compose: [mode: 'reply' | 'replyAll' | 'forward', mail: MailSummary]
  toggleUnread: [mail: MailSummary]
  toggleDone: [mail: MailSummary]
  label: [mail: MailSummary, label: string, on: boolean]
  delete: [mail: MailSummary]
  /** One of the bulk actions for the whole selection */
  batch: [action: MailBatchAction]
  batchLabel: [label: string, on: boolean]
  /** Warm the mail's body before the reader opens it */
  prefetch: [mail: MailSummary]
  /** The page writes the new selection to the URL */
  updateSelection: [keys: string[]]
}>()

const mailsRefs = ref<Record<string, Element | null>>({})
const scroller = ref<HTMLElement | null>(null)

/** The mail a shift-click range grows from; UI state, the selection itself is URL state */
const anchor = ref<string | undefined>()

const selection = computed(() => props.selection ?? [])

// One zone for the whole list, resolved once; the rows only format with it
const zone = useTimeZone()

const selectedMail = defineModel<MailSummary | null>()

const selectedKey = computed(() => selectedMail.value ? mailKey(selectedMail.value) : undefined)

const mailboxName = (mail: MailSummary) => props.mailboxNames?.[`${mail.service}/${mail.mailbox}`] ?? mail.mailbox

function scrollToTop() {
  if (scroller.value) {
    scroller.value.scrollTop = 0
  }
}

defineExpose({ scrollToTop })

// Load the next page shortly before the bottom, unless one is on its way or the list is complete
useInfiniteScroll(scroller, () => emits('loadMore'), {
  distance: 400,
  canLoadMore: () => !props.loadingMore && !props.done
})

watch(selectedMail, () => {
  if (!selectedKey.value) {
    return
  }
  const ref = mailsRefs.value[selectedKey.value]
  if (ref) {
    ref.scrollIntoView({ block: 'nearest' })
  }
})

function move(delta: 1 | -1) {
  const keys = props.mails.map(mail => mailKey(mail))
  const next = adjacentListKey(keys, selectedKey.value, delta)

  if (next === 'loadMore') {
    // Moving past the last item pulls in the next page
    emits('loadMore')
    return
  }
  if (next === null) {
    return
  }
  const mail = props.mails.find(item => mailKey(item) === next)
  if (mail) {
    selectedMail.value = mail
    // The rows on either side are what the next arrow key reaches; warm them too
    for (const key of neighbourListKeys(keys, next)) {
      const neighbour = props.mails.find(item => mailKey(item) === key)
      if (neighbour) {
        emits('prefetch', neighbour)
      }
    }
  }
}

/** Warm the body of a row the pointer points at, so a click opens it at once */
function prefetchMail(mail: MailSummary) {
  emits('prefetch', mail)
}

/**
 * A plain click still opens one mail. Ctrl/⌘-click toggles it in the selection
 * and Shift-click replaces the selection with the range from the last anchor.
 */
function selectMail(event: MouseEvent, mail: MailSummary) {
  const key = mailSelectionKey(mail)

  if (event.shiftKey) {
    emits('updateSelection', rangeSelection(props.mails.map(mailSelectionKey), anchor.value, key))
    return
  }

  if (event.metaKey || event.ctrlKey) {
    emits('updateSelection', toggleSelection(selection.value, key))
    anchor.value = key
    return
  }

  anchor.value = key
  selectedMail.value = mail
}

const isOpen = (mail: MailSummary) => !!selectedMail.value && selectedKey.value === mailKey(mail)

const isSelected = (mail: MailSummary) => isMailSelected(selection.value, mail)

defineShortcuts({
  arrowdown: () => move(1),
  arrowup: () => move(-1),
  escape: () => {
    if (selection.value.length) {
      emits('updateSelection', [])
    }
  }
})

/**
 * The context menu of one row, built lazily; other layers append their actions.
 * Right-clicking a selected mail acts on the whole selection; several targets
 * hide the single-mail entries and only offer the registered multi actions.
 */
function contextItems(mail: MailSummary): ContextMenuItem[][] {
  const targets = contextTargets(selection.value, mailSelectionKey(mail))
  const targetMails = targets
    .map(key => props.mails.find(item => mailSelectionKey(item) === key))
    .filter((item): item is MailSummary => !!item)

  const doneLabel = props.doneLabel ?? 'Done'

  if (targetMails.length > 1) {
    const groups = mailBatchContextMenuItems(
      `${targetMails.length} mails`,
      {
        permanent: targetMails.every(mail => props.isPermanent?.(mail) ?? false),
        done: labelToggleState(targetMails, doneLabel),
        doneLabel,
        labels: mailLabelChoices(props.labels ?? [], targetMails)
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
      targetMails.map(target => mailItemContext(target, props.service)),
      groups
    )
  }

  const groups = mailContextMenuItems(
    mail,
    {
      permanent: props.isPermanent?.(mail) ?? false,
      done: labelToggleState([mail], doneLabel),
      doneLabel,
      labels: mailLabelChoices(props.labels ?? [], [mail])
    },
    {
      open: () => { selectedMail.value = mail },
      compose: mode => emits('compose', mode, mail),
      toggleUnread: () => emits('toggleUnread', mail),
      toggleDone: () => emits('toggleDone', mail),
      setLabel: (label, on) => emits('label', mail, label, on),
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

    <TransitionGroup name="mail" tag="div" class="relative">
      <div
        v-for="mail in mails"
        :key="mailKey(mail)"
        :ref="(el: unknown) => { mailsRefs[mailKey(mail)] = el as Element | null }"
        :data-mail-key="mailKey(mail)"
        class="border-b border-default bg-default"
      >
        <UContextMenu :items="contextItems(mail)">
          <div
            class="p-4 sm:px-6 text-sm cursor-pointer border-l-2 transition-colors"
            :class="[
              mail.unread ? 'text-highlighted' : 'text-toned',
              isSelected(mail)
                ? 'border-primary bg-elevated ring-1 ring-inset ring-primary/40'
                : isOpen(mail)
                  ? 'border-primary bg-primary/10'
                  : 'border-bg hover:border-primary hover:bg-primary/5'
            ]"
            @mouseenter="prefetchMail(mail)"
            @pointerdown="prefetchMail(mail)"
            @click="selectMail($event, mail)"
          >
            <div class="flex items-center justify-between gap-2" :class="[mail.unread && 'font-semibold']">
              <div class="flex items-center gap-3 min-w-0">
                <span class="truncate">{{ formatMailAddress(mail.from[0]) }}</span>

                <UChip v-if="mail.unread" />
                <UIcon v-if="mail.flagged" name="i-lucide-star" class="size-3.5 shrink-0 text-warning" />
                <MailLabelBadges :labels="mail.labels" :done-label="doneLabel" />
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <span v-if="showMailbox" class="rounded bg-elevated px-1.5 py-0.5 text-xs font-normal text-dimmed">
                  {{ mailboxName(mail) }}
                </span>
                <span>{{ formatMailListDate(mail.date, zone) }}</span>
              </div>
            </div>
            <!-- eslint-disable-next-line vue/no-v-html -- highlightToHtml escapes the mail content -->
            <p class="truncate" :class="[mail.unread && 'font-semibold']" v-html="highlightToHtml(mail.subjectHighlight ?? mail.subject) || '(no subject)'" />
            <!-- eslint-disable-next-line vue/no-v-html -- highlightToHtml escapes the mail content -->
            <p v-if="mail.snippet" class="text-dimmed line-clamp-2" v-html="highlightToHtml(mail.snippet)" />
          </div>
        </UContextMenu>
      </div>
    </TransitionGroup>

    <slot name="more" />

    <div v-if="loadingMore" class="flex items-center justify-center p-4">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-dimmed" />
    </div>
    <p v-else-if="done && mails.length" class="p-4 text-center text-xs text-dimmed">
      No more mails
    </p>
  </div>
</template>

<style scoped>
.mail-enter-active {
  transition: opacity 300ms ease;
}

.mail-enter-from {
  opacity: 0;
}

.mail-leave-active {
  transition: opacity 300ms ease;
  position: absolute;
  left: 0;
  right: 0;
}

.mail-leave-to {
  opacity: 0;
}

.mail-move {
  transition: transform 300ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .mail-enter-active,
  .mail-leave-active,
  .mail-move {
    transition: none;
  }
}
</style>
