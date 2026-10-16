<script setup lang="ts">
import type { DriveEntry } from '#layers/drive/shared/types/drive'
import { downloadUrl, entryIcon, previewKind } from '../../utils/drive'

const props = defineProps<{
  entry: DriveEntry
  service: string
}>()

const kind = computed(() => previewKind(props.entry))
const thumbnail = computed(() => kind.value === 'image' ? downloadUrl(props.service, [props.entry.path], { inline: true }) : undefined)
</script>

<template>
  <img
    v-if="thumbnail"
    :src="thumbnail"
    :alt="entry.name"
    loading="lazy"
    class="size-full object-cover"
  >
  <UIcon
    v-else
    :name="entryIcon(entry)"
    class="size-full"
  />
</template>
