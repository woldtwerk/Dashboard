<script setup lang="ts">
import { breakpointsTailwind } from '@vueuse/core'
import type { DriveEntry } from '#layers/drive/shared/types/drive'
import { imageSrcset, imageUrl } from '#layers/image/app/utils/image-url'
import { downloadUrl, entryKindLabel, entryVersion, formatDate, formatSize, previewKind } from '../../utils/drive'
import { driveImageId } from '../../../shared/drive-image'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  entry: DriveEntry | null
  service: string
}>()

const emit = defineEmits<{
  download: []
  share: []
}>()

// The slideover fills the screen on phones and is a 28rem panel from `md` up,
// so the browser picks a derivative from that range — never a fixed breakpoint.
const { md } = breakpointsTailwind
const PREVIEW_WIDTHS = [384, 768, 1024, 1536]
const previewSizes = `(min-width: ${md}px) 28rem, 100vw`

const kind = computed(() => props.entry ? previewKind(props.entry) : undefined)
const previewUrl = computed(() => props.entry ? downloadUrl(props.service, [props.entry.path], { inline: true, version: entryVersion(props.entry) }) : '')
// Images are rendered by imgproxy at the panel's size instead of at the
// original's; PDF, video, audio and text keep streaming the file itself.
const imagePreviewUrl = computed(() => props.entry
  ? imageUrl('drive', driveImageId(props.service, props.entry.path), {
      width: 1024,
      fit: 'fit',
      v: entryVersion(props.entry)
    })
  : '')
const imagePreviewSrcset = computed(() => props.entry
  ? imageSrcset('drive', driveImageId(props.service, props.entry.path), {
      width: 1024,
      fit: 'fit',
      v: entryVersion(props.entry),
      widths: PREVIEW_WIDTHS
    })
  : '')

const rows = computed(() => {
  const entry = props.entry
  if (!entry) {
    return []
  }
  return [
    { label: 'Type', value: entryKindLabel(entry) },
    { label: 'Size', value: entry.type === 'folder' ? '—' : formatSize(entry.size) },
    { label: 'Modified', value: formatDate(entry.modified) },
    { label: 'Media type', value: entry.mediaType ?? '—' },
    { label: 'Path', value: entry.path }
  ]
})
</script>

<template>
  <USlideover v-model:open="open" title="Details">
    <template #body>
      <div v-if="entry" class="space-y-4">
        <div class="flex h-56 items-center justify-center overflow-hidden rounded-lg border border-default bg-elevated text-muted">
          <FilePreview
            :kind="kind"
            :src="kind === 'image' ? imagePreviewUrl : previewUrl"
            :srcset="kind === 'image' ? imagePreviewSrcset : undefined"
            :sizes="kind === 'image' ? previewSizes : undefined"
            :name="entry.name"
          >
            <template #fallback>
              <DriveEntryIcon
                :entry="entry"
                :service="service"
                class="size-16"
              />
            </template>
          </FilePreview>
        </div>

        <p class="break-words font-medium">
          {{ entry.name }}
        </p>

        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <template v-for="row in rows" :key="row.label">
            <dt class="text-muted">
              {{ row.label }}
            </dt>
            <dd class="break-all text-default">
              {{ row.value }}
            </dd>
          </template>
        </dl>

        <div class="flex flex-wrap gap-2">
          <GraphLinkButton
            v-if="entry"
            :entity="{ type: 'file', service, id: entry.path }"
          />
          <UButton
            label="Download"
            icon="i-lucide-download"
            color="neutral"
            variant="outline"
            size="sm"
            @click="emit('download')"
          />
          <UButton
            label="Share link"
            icon="i-lucide-link"
            color="neutral"
            variant="outline"
            size="sm"
            @click="emit('share')"
          />
        </div>
      </div>
    </template>
  </USlideover>
</template>
