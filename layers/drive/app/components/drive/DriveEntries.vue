<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ComponentPublicInstance } from 'vue'
import type { DriveEntry, DriveView } from '#layers/drive/shared/types/drive'
import type { SelectionMode } from '../../utils/drive'
import { formatDate, formatSize, THUMBNAIL_ICON_WIDTH, THUMBNAIL_TILE_WIDTH } from '../../utils/drive'

const props = defineProps<{
  entries: DriveEntry[]
  selected: string[]
  view: DriveView
  service: string
  loading?: boolean
  menuItems: (entry: DriveEntry) => DropdownMenuItem[]
}>()

const renamePath = defineModel<string | undefined>('renamePath')

const emit = defineEmits<{
  open: [entry: DriveEntry]
  select: [entry: DriveEntry, mode: SelectionMode]
  clear: []
  rename: [entry: DriveEntry, name: string]
  prefetch: [entry: DriveEntry]
  prefetchNow: [entry: DriveEntry]
  cancelPrefetch: [entry: DriveEntry]
  dragStart: [entry: DriveEntry]
  dropOn: [target: DriveEntry, files: File[] | null]
  dropFiles: [files: File[]]
}>()

const renameDraft = ref('')
const renameInput = ref<HTMLInputElement>()

watch(renamePath, (value) => {
  const entry = props.entries.find(item => item.path === value)
  if (!entry) {
    return
  }
  renameDraft.value = entry.name
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
})

function commitRename(entry: DriveEntry) {
  const name = renameDraft.value.trim()
  if (name && name !== entry.name) {
    emit('rename', entry, name)
  }
  renamePath.value = undefined
}

const isSelected = (entry: DriveEntry) => props.selected.includes(entry.path)

function clickMode(event: MouseEvent): SelectionMode {
  if (event.shiftKey) {
    return 'range'
  }
  return event.metaKey || event.ctrlKey ? 'toggle' : 'replace'
}

function onClick(event: MouseEvent, entry: DriveEntry) {
  emit('select', entry, clickMode(event))
}

function onDrop(event: DragEvent, target: DriveEntry) {
  const files = event.dataTransfer?.files?.length ? Array.from(event.dataTransfer.files) : null
  emit('dropOn', target, files)
}

function onDragStart(event: DragEvent, entry: DriveEntry) {
  event.dataTransfer?.setData('application/x-drive-entry', entry.path)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
  emit('dragStart', entry)
}

function onRootDrop(event: DragEvent) {
  const files = event.dataTransfer?.files?.length ? Array.from(event.dataTransfer.files) : []
  if (files.length) {
    emit('dropFiles', files)
  }
}
</script>

<template>
  <div
    class="min-h-0 flex-1 overflow-y-auto p-4"
    @click.self="emit('clear')"
    @dragover.prevent
    @drop.prevent="onRootDrop"
  >
    <div v-if="!entries.length && !loading" class="flex h-full items-center justify-center text-sm text-dimmed">
      This folder is empty
    </div>

    <div
      v-else-if="view === 'grid'"
      class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
    >
      <UContextMenu
        v-for="entry in entries"
        :key="entry.path"
        :items="menuItems(entry)"
      >
        <div
          class="group relative flex cursor-default flex-col items-center gap-2 rounded-lg border p-3 text-center transition select-none"
          :class="[
            isSelected(entry) ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated/50',
            entry.pending && 'opacity-60'
          ]"
          draggable="true"
          @click="onClick($event, entry)"
          @dblclick="emit('open', entry)"
          @mouseenter="emit('prefetch', entry)"
          @mouseleave="emit('cancelPrefetch', entry)"
          @pointerdown="emit('prefetchNow', entry)"
          @dragstart="onDragStart($event, entry)"
          @dragover.prevent
          @drop.stop.prevent="onDrop($event, entry)"
        >
          <div class="absolute start-2 top-2" @click.stop>
            <UCheckbox
              :model-value="isSelected(entry)"
              :aria-label="`Select ${entry.name}`"
              @update:model-value="emit('select', entry, 'toggle')"
            />
          </div>

          <div class="mt-4 flex size-14 items-center justify-center overflow-hidden rounded-lg bg-elevated text-muted">
            <DriveEntryIcon :entry="entry" :service="service" :width="THUMBNAIL_TILE_WIDTH" />
          </div>

          <div class="w-full min-w-0">
            <input
              v-if="renamePath === entry.path"
              :ref="(el: Element | ComponentPublicInstance | null) => { if (renamePath === entry.path) renameInput = el as HTMLInputElement }"
              v-model="renameDraft"
              class="w-full rounded border border-primary bg-default px-1 text-center text-sm outline-none"
              @click.stop
              @dblclick.stop
              @keydown.enter.prevent="commitRename(entry)"
              @keydown.esc.prevent="renamePath = undefined"
              @blur="commitRename(entry)"
            >
            <p v-else class="truncate text-sm font-medium" :title="entry.name">
              {{ entry.name }}
            </p>
            <p class="truncate text-xs text-dimmed">
              {{ entry.type === 'folder' ? 'Folder' : formatSize(entry.size) }}
            </p>
          </div>
        </div>
      </UContextMenu>
    </div>

    <div v-else class="overflow-hidden rounded-lg border border-default">
      <div class="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-default bg-elevated/50 px-3 py-2 text-xs font-medium text-muted">
        <span class="w-4" />
        <span>Name</span>
        <span class="w-24 text-end">Size</span>
        <span class="hidden w-40 text-end sm:block">Modified</span>
      </div>

      <UContextMenu
        v-for="entry in entries"
        :key="entry.path"
        :items="menuItems(entry)"
      >
        <div
          class="grid cursor-default grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-default px-3 py-2 text-sm last:border-b-0 select-none"
          :class="[isSelected(entry) ? 'bg-primary/5' : 'hover:bg-elevated/50', entry.pending && 'opacity-60']"
          draggable="true"
          @click="onClick($event, entry)"
          @dblclick="emit('open', entry)"
          @mouseenter="emit('prefetch', entry)"
          @mouseleave="emit('cancelPrefetch', entry)"
          @pointerdown="emit('prefetchNow', entry)"
          @dragstart="onDragStart($event, entry)"
          @dragover.prevent
          @drop.stop.prevent="onDrop($event, entry)"
        >
          <div class="flex w-4" @click.stop>
            <UCheckbox
              :model-value="isSelected(entry)"
              :aria-label="`Select ${entry.name}`"
              @update:model-value="emit('select', entry, 'toggle')"
            />
          </div>

          <div class="flex min-w-0 items-center gap-3">
            <div class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-elevated text-muted">
              <DriveEntryIcon :entry="entry" :service="service" :width="THUMBNAIL_ICON_WIDTH" />
            </div>
            <input
              v-if="renamePath === entry.path"
              :ref="(el: Element | ComponentPublicInstance | null) => { if (renamePath === entry.path) renameInput = el as HTMLInputElement }"
              v-model="renameDraft"
              class="w-full rounded border border-primary bg-default px-1 text-sm outline-none"
              @click.stop
              @dblclick.stop
              @keydown.enter.prevent="commitRename(entry)"
              @keydown.esc.prevent="renamePath = undefined"
              @blur="commitRename(entry)"
            >
            <span v-else class="truncate font-medium" :title="entry.name">{{ entry.name }}</span>
          </div>

          <span class="w-24 text-end text-xs text-dimmed">{{ entry.type === 'folder' ? '—' : formatSize(entry.size) }}</span>
          <span class="hidden w-40 text-end text-xs text-dimmed sm:block">{{ formatDate(entry.modified) }}</span>
        </div>
      </UContextMenu>
    </div>
  </div>
</template>
