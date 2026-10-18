<script setup lang="ts">
import { useIntersectionObserver } from '@vueuse/core'
import type { DriveEntry } from '#layers/drive/shared/types/drive'
import { imageSrcset, imageUrl } from '#layers/image/app/utils/image-url'
import { entryIcon, entryVersion, thumbnailAllowed, THUMBNAIL_TILE_WIDTH } from '../../utils/drive'
import type { ThumbnailSlot } from '../../utils/thumbnail-queue'
import { useThumbnailQueue } from '../../composables/useThumbnailQueue'
import { driveImageId } from '../../../shared/drive-image'

const props = defineProps<{
  entry: DriveEntry
  service: string
  /** Width of the 1x derivative; the 2x candidate doubles it. */
  width?: number
}>()

// The tile is only watched once it is on screen, and the derivative is queued
// so at most a couple load at a time — the provider serializes CLI calls.
const root = ref<HTMLElement>()
const loaded = ref(false)
const queue = useThumbnailQueue()

const allowed = computed(() => thumbnailAllowed(props.entry))
const id = computed(() => driveImageId(props.service, props.entry.path))
const width = computed(() => props.width ?? THUMBNAIL_TILE_WIDTH)
const src = computed(() => imageUrl('drive', id.value, {
  width: width.value,
  fit: 'fill',
  v: entryVersion(props.entry)
}))
const srcset = computed(() => imageSrcset('drive', id.value, {
  width: width.value,
  fit: 'fill',
  v: entryVersion(props.entry)
}))

const isIntersecting = ref(false)
useIntersectionObserver(root, ([entry]) => {
  isIntersecting.value = !!entry?.isIntersecting
}, { rootMargin: '200px' })

let slot: ThumbnailSlot | undefined
let release: (() => void) | undefined
let cancelled = false

function start() {
  if (loaded.value || slot) {
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
    loaded.value = true
  })
}

// Leaving the viewport before the load starts drops the request; once bytes are
// on their way they are kept, so scrolling back does not fetch them again.
function stop() {
  if (loaded.value) {
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
      v-if="loaded"
      :src="src"
      :srcset="srcset"
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
