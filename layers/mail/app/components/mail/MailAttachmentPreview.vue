<script setup lang="ts">
import type { MailAttachment, MailSummary } from '#layers/mail/shared/types/mail'
import type { AttachmentAction } from '#layers/core/app/utils/attachment-actions'
import { attachmentActionsFor } from '#layers/core/app/utils/attachment-actions'
import { filePreviewKind } from '#layers/core/shared/file-preview'
import {
  adjacentAttachmentPart,
  attachmentPreviewIndex,
  mailAttachmentByPart,
  mailEntityRef,
  visibleMailAttachments
} from '#layers/mail/shared/mail-attachments'
import { downloadMailAttachment, mailAttachmentUrl } from '#layers/mail/app/utils/mail-attachments'
import { MAIL_SHORTCUT_KEYS } from '#layers/mail/app/utils/mail-shortcuts'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  attachments: MailAttachment[]
  part?: string
  service: string
  mail: Pick<MailSummary, 'uid' | 'mailbox' | 'subject'>
  /** The message is still on its way; the URL already names a part */
  loading?: boolean
}>()

const emits = defineEmits<{
  'update:part': [part: string]
}>()

const visible = computed(() => visibleMailAttachments(props.attachments))
const current = computed(() => mailAttachmentByPart(props.attachments, props.part))
const index = computed(() => attachmentPreviewIndex(visible.value, props.part))
const kind = computed(() => current.value ? filePreviewKind(current.value.contentType, current.value.filename) : undefined)

const inlineUrl = computed(() => current.value?.part
  ? mailAttachmentUrl(props.service, props.mail.mailbox, props.mail.uid, current.value.part, true)
  : '')
const downloadUrl = computed(() => current.value?.part
  ? mailAttachmentUrl(props.service, props.mail.mailbox, props.mail.uid, current.value.part)
  : '')

const entityRef = computed(() => mailEntityRef(props.service, props.mail.mailbox, props.mail.uid))
const actions = computed(() => current.value
  ? attachmentActionsFor({ source: 'mail', ref: entityRef.value, attachments: [current.value] })
  : [])

/** The action whose save is running, so its button shows a spinner */
const busy = ref<string>()

function move(delta: 1 | -1) {
  const next = adjacentAttachmentPart(props.attachments, props.part, delta)
  if (next) {
    emits('update:part', next)
  }
}

function downloadCurrent() {
  if (current.value) {
    downloadMailAttachment(downloadUrl.value, current.value.filename)
  }
}

async function run(action: AttachmentAction) {
  if (!current.value || busy.value) {
    return
  }
  busy.value = action.id
  try {
    await action.run({ source: 'mail', ref: entityRef.value, attachments: [current.value] })
  } finally {
    busy.value = undefined
  }
}

defineShortcuts({
  [MAIL_SHORTCUT_KEYS.previewPrevious[0]]: { handler: () => move(-1) },
  [MAIL_SHORTCUT_KEYS.previewNext[0]]: { handler: () => move(1) },
  [MAIL_SHORTCUT_KEYS.download[0]]: { handler: downloadCurrent },
  [MAIL_SHORTCUT_KEYS.closePreview[0]]: { handler: () => { open.value = false } }
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="current?.filename ?? mail.subject ?? 'Attachment'"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="flex h-[60vh] min-h-64 items-center justify-center overflow-hidden rounded-lg border border-default bg-elevated text-muted">
        <div v-if="loading && !current" class="flex items-center justify-center">
          <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-dimmed" />
        </div>
        <FilePreview
          v-else-if="current && kind"
          :kind="kind"
          :src="inlineUrl"
          :name="current.filename"
        />
        <div v-else class="space-y-2 p-6 text-center">
          <UIcon name="i-lucide-file-x" class="mx-auto size-10 text-dimmed" />
          <p class="text-sm text-muted">
            No preview available for this file.
          </p>
        </div>
      </div>

      <div class="mt-3 flex items-center justify-between gap-2">
        <UTooltip text="Previous attachment" :kbds="[...MAIL_SHORTCUT_KEYS.previewPrevious]">
          <UButton
            icon="i-lucide-chevron-left"
            color="neutral"
            variant="ghost"
            :disabled="index <= 0"
            aria-label="Previous attachment"
            @click="move(-1)"
          />
        </UTooltip>
        <p class="min-w-0 truncate text-xs text-muted">
          {{ index + 1 }} of {{ visible.length }}
        </p>
        <UTooltip text="Next attachment" :kbds="[...MAIL_SHORTCUT_KEYS.previewNext]">
          <UButton
            icon="i-lucide-chevron-right"
            color="neutral"
            variant="ghost"
            :disabled="index < 0 || index >= visible.length - 1"
            aria-label="Next attachment"
            @click="move(1)"
          />
        </UTooltip>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <UTooltip text="Download" :kbds="[...MAIL_SHORTCUT_KEYS.download]">
          <UButton
            label="Download"
            icon="i-lucide-download"
            color="neutral"
            variant="outline"
            :disabled="!current"
            @click="downloadCurrent"
          />
        </UTooltip>
        <UButton
          v-for="action in actions"
          :key="action.id"
          :label="action.label"
          :icon="action.icon"
          color="neutral"
          variant="outline"
          :loading="busy === action.id"
          :disabled="!!busy && busy !== action.id"
          @click="run(action)"
        />
      </div>
    </template>
  </UModal>
</template>
