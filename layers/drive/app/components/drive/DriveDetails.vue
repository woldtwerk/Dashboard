<script setup lang="ts">
import type { DriveEntry } from '#layers/drive/shared/types/drive'
import { downloadUrl, entryKindLabel, formatDate, formatSize, previewKind } from '../../utils/drive'
import { driveRequest } from '../../utils/drive-request'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  entry: DriveEntry | null
  service: string
}>()

const emit = defineEmits<{
  download: []
  share: []
}>()

const kind = computed(() => props.entry ? previewKind(props.entry) : undefined)
const previewUrl = computed(() => props.entry ? downloadUrl(props.service, [props.entry.path], { inline: true }) : '')
const text = ref<string>()

watch(() => props.entry?.path, async () => {
  text.value = undefined
  if (!import.meta.client || !props.entry || kind.value !== 'text') {
    return
  }
  try {
    text.value = await driveRequest<string>(previewUrl.value, { text: true })
  } catch {
    text.value = undefined
  }
}, { immediate: true })

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
          <img
            v-if="kind === 'image'"
            :src="previewUrl"
            :alt="entry.name"
            class="max-h-full max-w-full object-contain"
          >
          <iframe
            v-else-if="kind === 'pdf'"
            :src="previewUrl"
            title="PDF preview"
            class="size-full"
          />
          <video
            v-else-if="kind === 'video'"
            :src="previewUrl"
            controls
            class="max-h-full max-w-full"
          />
          <audio
            v-else-if="kind === 'audio'"
            :src="previewUrl"
            controls
            class="w-full px-4"
          />
          <pre
            v-else-if="kind === 'text' && text !== undefined"
            class="size-full overflow-auto p-3 text-start text-xs whitespace-pre-wrap"
          >{{ text }}</pre>
          <DriveEntryIcon
            v-else
            :entry="entry"
            :service="service"
            class="size-16"
          />
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
