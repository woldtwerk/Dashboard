<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MailAttachment, MailSummary } from '#layers/mail/shared/types/mail'
import type { AttachmentAction, AttachmentActionContext } from '#layers/core/app/utils/attachment-actions'
import { mailEntityRef, visibleMailAttachments } from '#layers/mail/shared/mail-attachments'
import { filePreviewKind, formatFileSize } from '#layers/core/shared/file-preview'
import { downloadMailAttachment, mailAttachmentPreviewToQuery, mailAttachmentUrl } from '#layers/mail/app/utils/mail-attachments'
import { mailAttachmentMenuItems } from '#layers/mail/app/utils/mail-attachment-menu'

const props = defineProps<{
  attachments: MailAttachment[]
  mail: MailSummary
  service: string
}>()

const route = useRoute()
const router = useRouter()

const visible = computed(() => visibleMailAttachments(props.attachments))
const entityRef = computed(() => mailEntityRef(props.service, props.mail.mailbox, props.mail.uid))

/** The part whose action is running, so its chip shows the spinner */
const busy = ref<string>()

function attachmentIcon(attachment: MailAttachment): string {
  switch (filePreviewKind(attachment.contentType, attachment.filename)) {
    case 'image':
      return 'i-lucide-file-image'
    case 'pdf':
    case 'text':
      return 'i-lucide-file-text'
    case 'video':
      return 'i-lucide-file-video'
    case 'audio':
      return 'i-lucide-file-audio'
    default:
      return 'i-lucide-file'
  }
}

function inlineUrl(attachment: MailAttachment): string {
  return mailAttachmentUrl(props.service, props.mail.mailbox, props.mail.uid, attachment.part!, true)
}

function downloadUrl(attachment: MailAttachment): string {
  return mailAttachmentUrl(props.service, props.mail.mailbox, props.mail.uid, attachment.part!)
}

function updateQuery(patch: Record<string, string | undefined>) {
  const query = Object.fromEntries(Object.entries({ ...route.query, ...patch })
    .filter(([, value]) => value !== undefined && value !== null && value !== ''))
  router.replace({ query })
}

function openPreview(attachment: MailAttachment) {
  if (!attachment.part) {
    return
  }
  updateQuery(mailAttachmentPreviewToQuery({
    part: attachment.part,
    uid: props.mail.uid,
    mailbox: props.mail.mailbox
  }) as Record<string, string | undefined>)
}

function contextFor(attachment: MailAttachment): AttachmentActionContext {
  return { source: 'mail', ref: entityRef.value, attachments: [attachment] }
}

function menuItems(attachment: MailAttachment): DropdownMenuItem[][] {
  return mailAttachmentMenuItems(contextFor(attachment), {
    preview: () => openPreview(attachment),
    download: () => downloadMailAttachment(downloadUrl(attachment), attachment.filename),
    action: action => void runAction(action, attachment)
  })
}

async function runAction(action: AttachmentAction, attachment: MailAttachment) {
  const part = attachment.part
  if (!part || busy.value) {
    return
  }

  busy.value = part
  try {
    await action.run(contextFor(attachment))
  } finally {
    busy.value = undefined
  }
}

// Warm the first bytes a preview would need; a second hover is served from the browser cache
const PREFETCH_MAX_BYTES = 5 * 1024 * 1024
const PREFETCH_KINDS = new Set(['image', 'pdf', 'text'])
const prefetched = new Set<string>()

function prefetch(attachment: MailAttachment) {
  if (!import.meta.client || !attachment.part) {
    return
  }
  const kind = filePreviewKind(attachment.contentType, attachment.filename)
  if (!kind || !PREFETCH_KINDS.has(kind)) {
    return
  }
  if (attachment.size === undefined || attachment.size >= PREFETCH_MAX_BYTES) {
    return
  }
  const url = inlineUrl(attachment)
  if (prefetched.has(url)) {
    return
  }
  prefetched.add(url)
  void fetch(url, { credentials: 'same-origin' })
    .then(response => response.arrayBuffer())
    .catch(() => prefetched.delete(url))
}
</script>

<template>
  <div v-if="visible.length" class="flex flex-wrap gap-1.5">
    <UDropdownMenu
      v-for="attachment in visible"
      :key="attachment.part"
      :items="menuItems(attachment)"
    >
      <UButton
        color="neutral"
        variant="subtle"
        size="xs"
        :icon="attachmentIcon(attachment)"
        :loading="busy === attachment.part"
        :disabled="!!busy && busy !== attachment.part"
        :aria-label="`Attachment ${attachment.filename}`"
        @mouseenter="prefetch(attachment)"
      >
        <span class="max-w-48 truncate">{{ attachment.filename }}</span>
        <span class="shrink-0 text-dimmed">{{ formatFileSize(attachment.size) }}</span>
      </UButton>
    </UDropdownMenu>
  </div>
</template>
