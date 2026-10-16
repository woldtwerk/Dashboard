<script setup lang="ts">
import type { DriveEntry } from '#layers/drive/shared/types/drive'
import { breadcrumbs, isWithinPath, parentPath } from '#layers/drive/shared/drive-path'
import { entryIcon } from '../../utils/drive'
import { driveRequest } from '../../utils/drive-request'

const open = defineModel<boolean>('open', { required: true })

const props = withDefaults(defineProps<{
  service: string
  title?: string
  confirmLabel?: string
  /** Paths that cannot be a target, e.g. the folder being moved */
  exclude?: string[]
}>(), {
  title: 'Choose a folder',
  confirmLabel: 'Move here',
  exclude: () => []
})

const emit = defineEmits<{
  select: [path: string]
}>()

const path = ref('/my-files')
const entries = ref<DriveEntry[]>([])
const loading = ref(false)

const crumbs = computed(() => breadcrumbs(path.value))

const disabled = (entry: DriveEntry) => props.exclude.some(excluded => isWithinPath(entry.path, excluded) || entry.path === excluded)

async function load() {
  loading.value = true
  try {
    const result = await driveRequest<DriveEntry[]>('/api/drive/contents', { query: { service: props.service, path: path.value } })
    entries.value = result.filter(entry => entry.type === 'folder')
  } catch {
    entries.value = []
  } finally {
    loading.value = false
  }
}

watch(open, (value) => {
  if (value) {
    path.value = '/my-files'
    load()
  }
})

watch(path, load)

function choose() {
  emit('select', path.value)
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <div class="space-y-3">
        <nav class="flex flex-wrap items-center gap-1 text-sm">
          <button
            v-if="path !== '/my-files'"
            type="button"
            class="rounded-md px-2 py-1 text-muted hover:bg-elevated hover:text-default"
            @click="path = parentPath(path)"
          >
            <UIcon name="i-lucide-corner-left-up" class="inline size-4" />
            Up
          </button>
          <template v-for="(crumb, index) in crumbs" :key="crumb.path">
            <UIcon v-if="index" name="i-lucide-chevron-right" class="size-4 text-dimmed" />
            <button
              type="button"
              class="truncate rounded-md px-2 py-1 hover:bg-elevated"
              :class="crumb.path === path ? 'font-medium text-default' : 'text-muted'"
              @click="path = crumb.path"
            >
              {{ crumb.name }}
            </button>
          </template>
        </nav>

        <div class="max-h-64 overflow-y-auto rounded-lg border border-default">
          <div v-if="loading" class="flex justify-center py-6">
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-dimmed" />
          </div>
          <p v-else-if="!entries.length" class="px-3 py-6 text-center text-sm text-dimmed">
            No subfolders
          </p>
          <button
            v-for="entry in entries"
            :key="entry.path"
            type="button"
            class="flex w-full items-center gap-3 border-b border-default px-3 py-2 text-start text-sm last:border-b-0"
            :class="disabled(entry) ? 'cursor-not-allowed opacity-50' : 'hover:bg-elevated/50'"
            :disabled="disabled(entry)"
            @click="path = entry.path"
          >
            <UIcon :name="entryIcon(entry)" class="size-4 shrink-0 text-muted" />
            <span class="truncate">{{ entry.name }}</span>
          </button>
        </div>

        <p class="truncate text-xs text-dimmed">
          Target: {{ path }}
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="open = false"
        />
        <UButton
          :label="confirmLabel"
          icon="i-lucide-folder-check"
          :disabled="loading"
          @click="choose"
        />
      </div>
    </template>
  </UModal>
</template>
