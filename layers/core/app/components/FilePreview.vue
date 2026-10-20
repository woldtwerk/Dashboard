<script setup lang="ts">
import type { FilePreviewKind } from '#layers/core/shared/file-preview'
import { PREVIEW_TEXT_MAX_BYTES, readTextUpTo } from '#layers/core/shared/file-preview'

const props = withDefaults(defineProps<{
  /** How the file can be rendered; undefined shows the fallback slot */
  kind?: FilePreviewKind
  /** The URL the bytes come from */
  src: string
  name: string
  /** Optional responsive image candidates */
  srcset?: string
  sizes?: string
  /** How much of a text file to read; long logs stay a preview */
  maxTextBytes?: number
}>(), {
  maxTextBytes: PREVIEW_TEXT_MAX_BYTES
})

const text = ref<string>()
const loadingText = ref(false)

watch([() => props.src, () => props.kind], async () => {
  text.value = undefined
  if (!import.meta.client || props.kind !== 'text' || !props.src) {
    return
  }

  loadingText.value = true
  try {
    const response = await fetch(props.src, { credentials: 'same-origin' })
    if (!response.ok || !response.body) {
      throw new Error(`Text preview answered ${response.status}`)
    }
    const preview = await readTextUpTo(response.body, props.maxTextBytes)
    text.value = preview.text
  } catch {
    text.value = undefined
  } finally {
    loadingText.value = false
  }
}, { immediate: true })
</script>

<template>
  <div class="flex size-full items-center justify-center overflow-hidden">
    <img
      v-if="kind === 'image'"
      :src="src"
      :srcset="srcset"
      :sizes="sizes"
      :alt="name"
      class="max-h-full max-w-full object-contain"
    >
    <iframe
      v-else-if="kind === 'pdf'"
      :src="src"
      :title="`${name} preview`"
      class="size-full"
    />
    <video
      v-else-if="kind === 'video'"
      :src="src"
      controls
      class="max-h-full max-w-full"
    />
    <audio
      v-else-if="kind === 'audio'"
      :src="src"
      controls
      class="w-full px-4"
    />
    <div v-else-if="kind === 'text'" class="size-full overflow-auto">
      <div v-if="loadingText" class="flex size-full items-center justify-center">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-dimmed" />
      </div>
      <pre v-else-if="text !== undefined" class="size-full overflow-auto p-3 text-start text-xs whitespace-pre-wrap">{{ text }}</pre>
      <div v-else class="flex size-full items-center justify-center">
        <slot name="fallback">
          <UIcon name="i-lucide-file" class="size-16 text-dimmed" />
        </slot>
      </div>
    </div>
    <slot v-else name="fallback">
      <UIcon name="i-lucide-file" class="size-16 text-dimmed" />
    </slot>
  </div>
</template>
