<script setup lang="ts">
import { useIntersectionObserver } from '@vueuse/core'
import type { DriveEntry } from '#layers/drive/shared/types/drive'
import { downloadUrl, entryIcon, entryVersion, thumbnailAllowed } from '../../utils/drive'
import type { ThumbnailSlot } from '../../utils/thumbnail-queue'
import { useThumbnailQueue } from '../../composables/useThumbnailQueue'

const props = defineProps<{
  entry: DriveEntry
  service: string
}>()

// The tile is only watched once it is on screen, and the thumbnail is queued so
// at most a couple load at a time — the provider serializes CLI calls.
const root = ref<HTMLElement>()
const src = ref<string>()
const queue = useThumbnailQueue()

const allowed = computed(() => thumbnailAllowed(props.entry))
const url = computed(() => downloadUrl(props.service, [props.entry.path], {
  inline: true,
  version: entryVersion(props.entry)
}))

const isIntersecting = ref(false)
useIntersectionObserver(root, ([entry]) => {
  isIntersecting.value = !!entry?.isIntersecting
}, { rootMargin: '200px' })

let slot: ThumbnailSlot | undefined
let release: (() => void) | undefined
let cancelled = false

function start() {
  if (src.value || slot) {
    return
  }
  cancelled = false
  slot = queue.acquire()
  slot.promise.then((done) => {
    release = done
    if (cancelled) {
      done()
      return
    }
    src.value = url.value
  })
}

// Leaving the viewport before the load starts drops the request; once bytes are
// on their way they are kept, so scrolling back does not fetch them again.
function stop() {
  if (src.value) {
    return
  }
  cancelled = true
  slot?.cancel()
  slot = undefined
  release?.()
  release = undefined
}

function settled() {
  release?.()
  release = undefined
}

watch([allowed, isIntersecting], () => {
  if (allowed.value && isIntersecting.value) {
    start()
  } else if (!isIntersecting.value) {
    stop()
  }
}, { immediate: true })

onUnmounted(stop)
</script>

<template>
  <div ref="root" class="size-full">
    <img
      v-if="src"
      :src="src"
      :alt="entry.name"
      loading="lazy"
      decoding="async"
      class="size-full object-cover"
      @load="settled"
      @error="settled"
    >
    <UIcon
      v-else
      :name="entryIcon(entry)"
      class="size-full"
    />
  </div>
</template>
