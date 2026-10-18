<script setup lang="ts">
import { refDebounced, useDebounceFn } from '@vueuse/core'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { DriveEntry, DriveInvitation, DriveOrder, DriveSort, DriveView } from '#layers/drive/shared/types/drive'
import type { DriveSelectionAction } from '../utils/selection-action'
import { breadcrumbs, isWithinPath, joinPath, parentPath } from '#layers/drive/shared/drive-path'
import { DRIVE_SECTIONS, downloadUrl, filterEntries, sectionByKey, sectionOf, sortEntries } from '../utils/drive'
import { driveRequest } from '../utils/drive-request'

useSeoMeta({ title: 'Drive' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

const { data: allServices } = await useServices()
const services = computed(() => allServices.value.filter(item => item.domain === 'drive'))

if (!services.value.length) {
  await navigateTo('/services/new', { replace: true })
}

// Account, folder, view, sort and search live in the URL, so links can share them
const queryString = (key: string) => typeof route.query[key] === 'string' ? route.query[key] : undefined

function updateQuery(patch: Record<string, string | null | undefined>) {
  router.replace({ query: Object.fromEntries(Object.entries({ ...route.query, ...patch }).filter(([, value]) => value)) })
}

const service = computed(() => services.value.find(item => item.id === queryString('service'))?.id ?? services.value[0]?.id ?? '')
const path = computed(() => queryString('path') ?? '/my-files')
const section = computed(() => sectionOf(path.value))
const view = computed<DriveView>(() => queryString('view') === 'list' ? 'list' : 'grid')
const sort = computed<DriveSort>(() => {
  const value = queryString('sort')
  return value === 'modified' || value === 'size' ? value : 'name'
})
const order = computed<DriveOrder>(() => queryString('order') === 'desc' ? 'desc' : 'asc')
const search = ref(queryString('q') ?? '')
const debouncedSearch = refDebounced(search, 300)
watch(debouncedSearch, value => updateQuery({ q: value.trim() || null }))
watch(() => queryString('q'), (value) => {
  if ((value ?? '') !== debouncedSearch.value.trim()) {
    search.value = value ?? ''
  }
})

const nuxtApp = useNuxtApp()
const contentsKey = computed(() => `drive:${service.value}:${path.value}`)

// A visited or prefetched folder is read straight from the payload, so it shows
// at once and still revalidates in the background. A manual refresh always
// fetches, so the refresh button is not answered by the cache.
const { data: entries, status, error, refresh } = await useFetch<DriveEntry[]>('/api/drive/contents', {
  query: computed(() => ({ service: service.value, path: path.value })),
  key: contentsKey,
  default: () => [],
  getCachedData(key, app, ctx) {
    if (ctx.cause === 'refresh:manual') {
      return undefined
    }
    return app.payload.data[key] ?? app.static.data[key]
  }
})

// Only a first, dataless load may show a spinner; a revalidation keeps the list
const loading = computed(() => status.value === 'pending' && !entries.value.length)

// A cached listing is shown at once, which makes Nuxt skip the request; refresh
// it in the background anyway, so a folder changed elsewhere is not stale.
watch(contentsKey, () => {
  if (import.meta.client && nuxtApp.payload.data[contentsKey.value] !== undefined) {
    refresh()
  }
})

const visible = computed(() => sortEntries(filterEntries(entries.value, debouncedSearch.value), sort.value, order.value))
const visiblePaths = computed(() => visible.value.map(entry => entry.path))

const refreshFromEvents = useDebounceFn(() => refresh(), 300)
useDomainEvents({ domains: ['drive'] }, (event) => {
  if (driveRefreshFor(event, path.value)) {
    refreshFromEvents()
  }
}, {
  onReconnect: () => refreshFromEvents()
})

// --- Prefetch -------------------------------------------------------------

// A hover or a press on a folder tile loads its listing into the Nuxt payload,
// so opening it shows the cached answer immediately.
const prefetched = new Set<string>()

function prefetchPath(target: string) {
  if (!import.meta.client) {
    return
  }
  const key = `drive:${service.value}:${target}`
  if (nuxtApp.payload.data[key] !== undefined || prefetched.has(key)) {
    return
  }
  prefetched.add(key)
  driveRequest<DriveEntry[]>('/api/drive/contents', { query: { service: service.value, path: target } })
    .then((list) => { nuxtApp.payload.data[key] = list })
    .catch(() => {})
}

function prefetch(entry: DriveEntry) {
  if (entry.type === 'folder') {
    prefetchPath(entry.path)
  }
}

// The breadcrumb ancestors of the shown folder are the likeliest next step, e.g. "up"
watch([service, path], () => {
  for (const crumb of breadcrumbs(parentPath(path.value))) {
    prefetchPath(crumb.path)
  }
}, { immediate: true })

// --- Navigation -----------------------------------------------------------

function navigate(next: string) {
  selection.clear()
  updateQuery({ path: next === '/my-files' ? null : next, item: null })
}

const sectionTabs = DRIVE_SECTIONS.map(item => ({ label: item.label, value: item.key, icon: item.icon }))
const activeSection = computed({
  get: () => section.value.key as string,
  set: (key: string) => navigate(sectionByKey(key)!.root)
})

function open(entry: DriveEntry) {
  if (entry.type === 'folder') {
    navigate(entry.path)
  } else {
    updateQuery({ item: entry.path })
  }
}

// --- Selection ------------------------------------------------------------

const selection = useDriveSelection()
const selectedEntries = computed(() => visible.value.filter(entry => selection.selected.value.includes(entry.path)))

// --- Uploads --------------------------------------------------------------

const upload = useDriveUpload()
const fileInput = ref<HTMLInputElement>()

function pickFiles() {
  fileInput.value?.click()
}

async function uploadTo(target: string, files: File[]) {
  try {
    await upload.upload(service.value, target, files)
    await refresh()
  } catch (failure) {
    toast.add({ title: failure instanceof Error ? failure.message : 'Upload failed', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length) {
    uploadTo(path.value, files)
  }
}

// --- Optimistic updates ---------------------------------------------------

async function applyOptimistic(mutate: (list: DriveEntry[]) => DriveEntry[], request: () => Promise<unknown>, failureMessage: string) {
  const previous = entries.value
  entries.value = mutate(previous)
  try {
    await request()
    await refresh()
  } catch (failure) {
    entries.value = previous
    const message = failure instanceof Error ? failure.message : failureMessage
    toast.add({ title: message, color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function createFolder(name: string) {
  const entry: DriveEntry = {
    uid: `pending:${name}`,
    name,
    type: 'folder',
    parent: path.value,
    path: joinPath(path.value, name),
    pending: true
  }
  return applyOptimistic(
    list => [...list, entry],
    () => driveRequest('/api/drive/folder', { method: 'POST', body: { service: service.value, path: path.value, name } }),
    'Could not create the folder'
  )
}

function rename(entry: DriveEntry, name: string) {
  const nextPath = joinPath(entry.parent, name)
  return applyOptimistic(
    list => list.map(item => item.path === entry.path ? { ...item, name, path: nextPath, pending: true } : item),
    () => driveRequest('/api/drive/rename', { method: 'POST', body: { service: service.value, path: entry.path, name } }),
    'Could not rename the entry'
  )
}

function move(paths: string[], target: string) {
  // Refuse a move into the folder itself, into one of its descendants, or a no-op
  if (paths.some(item => isWithinPath(item, target)) || paths.every(item => parentPath(item) === target)) {
    return
  }
  selection.clear()
  return applyOptimistic(
    list => list.filter(item => !paths.includes(item.path)),
    () => driveRequest('/api/drive/move', { method: 'POST', body: { service: service.value, paths, target } }),
    'Could not move the selection'
  )
}

function copy(paths: string[], target: string, name?: string) {
  selection.clear()
  // Copying into the current folder can be shown at once; anywhere else waits for the refresh
  const sources = entries.value.filter(item => paths.includes(item.path))
  const placeholders = target === path.value
    ? sources.map(item => ({ ...item, uid: `pending:copy:${item.path}`, pending: true }))
    : []
  return applyOptimistic(
    list => [...list, ...placeholders],
    () => driveRequest('/api/drive/copy', { method: 'POST', body: { service: service.value, paths, target, name } }),
    'Could not copy the selection'
  )
}

function trash(paths: string[]) {
  selection.clear()
  return applyOptimistic(
    list => list.filter(item => !paths.includes(item.path)),
    () => driveRequest('/api/drive/trash', { method: 'POST', body: { service: service.value, paths } }),
    'Could not move to trash'
  )
}

function restore(paths: string[]) {
  selection.clear()
  return applyOptimistic(
    list => list.filter(item => !paths.includes(item.path)),
    () => driveRequest('/api/drive/restore', { method: 'POST', body: { service: service.value, paths } }),
    'Could not restore the selection'
  )
}

function removeForever(paths: string[]) {
  selection.clear()
  return applyOptimistic(
    list => list.filter(item => !paths.includes(item.path)),
    () => driveRequest('/api/drive/delete', { method: 'POST', body: { service: service.value, paths } }),
    'Could not delete the selection'
  )
}

async function emptyTrash() {
  await applyOptimistic(
    () => [],
    () => driveRequest('/api/drive/empty-trash', { method: 'POST', body: { service: service.value } }),
    'Could not empty the trash'
  )
}

function download(paths: string[]) {
  if (!paths.length) {
    return
  }
  const link = document.createElement('a')
  link.href = downloadUrl(service.value, paths)
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

// --- Drag and drop --------------------------------------------------------

const dragging = ref<string[]>([])

function onDragStart(entry: DriveEntry) {
  dragging.value = selection.selected.value.includes(entry.path) ? selection.selected.value : [entry.path]
}

function onDropOn(target: DriveEntry, files: File[] | null) {
  if (files?.length) {
    uploadTo(target.path, files)
  } else if (dragging.value.length) {
    move(dragging.value, target.path)
  }
  dragging.value = []
}

// --- Dialogs --------------------------------------------------------------

const renamePath = ref<string>()

const newFolderOpen = ref(false)
const newFolderName = ref('')

async function confirmNewFolder() {
  const name = newFolderName.value.trim()
  newFolderOpen.value = false
  newFolderName.value = ''
  if (name) {
    await createFolder(name)
  }
}

const pickerOpen = ref(false)
const pickerMode = ref<'move' | 'copy'>('move')
const pickerSource = ref<string[]>([])

function startPicker(mode: 'move' | 'copy', paths: string[]) {
  pickerSource.value = paths
  pickerMode.value = mode
  pickerOpen.value = true
}

function onPicked(target: string) {
  if (pickerMode.value === 'move') {
    move(pickerSource.value, target)
  } else {
    copy(pickerSource.value, target)
  }
}

const shareOpen = ref(false)
const shareEntry = ref<DriveEntry | null>(null)

function openShare(entry: DriveEntry) {
  shareEntry.value = entry
  shareOpen.value = true
}

const confirmState = reactive({ open: false, title: '', description: '', confirmLabel: 'Confirm', action: undefined as (() => void) | undefined })

function askConfirm(title: string, description: string, confirmLabel: string, action: () => void) {
  Object.assign(confirmState, { open: true, title, description, confirmLabel, action })
}

function runConfirm() {
  confirmState.action?.()
  confirmState.open = false
}

// --- Details --------------------------------------------------------------

const item = computed(() => queryString('item'))
const detailEntry = computed(() => entries.value.find(entry => entry.path === item.value) ?? null)
const detailsOpen = computed({
  get: () => !!detailEntry.value,
  set: (value: boolean) => {
    if (!value) {
      updateQuery({ item: null })
    }
  }
})

// --- Invitations ----------------------------------------------------------

const { data: invitations, refresh: refreshInvitations } = await useFetch<DriveInvitation[]>('/api/drive/invitations', {
  query: computed(() => ({ service: service.value })),
  default: () => [],
  immediate: false,
  server: false
})

watch([() => section.value.listsInvitations, service], () => {
  if (section.value.listsInvitations) {
    refreshInvitations()
  }
}, { immediate: true })

async function respondInvitation(invitation: DriveInvitation, accept: boolean) {
  try {
    await driveRequest(`/api/drive/invitations/${encodeURIComponent(invitation.uid)}`, {
      method: 'POST',
      body: { service: service.value, accept }
    })
    await refreshInvitations()
    if (accept) {
      await refresh()
    }
  } catch (failure) {
    toast.add({
      title: failure instanceof Error ? failure.message : 'Could not respond to the invitation',
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  }
}

// --- Menus and toolbar ----------------------------------------------------

const sortItems = computed<DropdownMenuItem[]>(() => ([
  { label: 'Name', icon: 'i-lucide-arrow-down-a-z', type: 'checkbox', checked: sort.value === 'name', onSelect: () => updateQuery({ sort: null }) },
  { label: 'Modified', icon: 'i-lucide-clock', type: 'checkbox', checked: sort.value === 'modified', onSelect: () => updateQuery({ sort: 'modified' }) },
  { label: 'Size', icon: 'i-lucide-hard-drive', type: 'checkbox', checked: sort.value === 'size', onSelect: () => updateQuery({ sort: 'size' }) }
]))

function menuItems(entry: DriveEntry): DropdownMenuItem[] {
  const items: DropdownMenuItem[] = [
    entry.type === 'folder'
      ? { label: 'Open', icon: 'i-lucide-folder-open', onSelect: () => open(entry) }
      : { label: 'Preview', icon: 'i-lucide-eye', onSelect: () => open(entry) },
    { label: 'Download', icon: 'i-lucide-download', onSelect: () => download([entry.path]) }
  ]

  if (section.value.key === 'trash') {
    items.push(
      { label: 'Restore', icon: 'i-lucide-rotate-ccw', onSelect: () => restore([entry.path]) },
      { label: 'Delete permanently', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => askConfirm('Delete permanently?', `"${entry.name}" will be removed forever.`, 'Delete', () => removeForever([entry.path])) }
    )
  } else {
    items.push(
      { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => { renamePath.value = entry.path } },
      { label: 'Move to…', icon: 'i-lucide-folder-input', onSelect: () => startPicker('move', [entry.path]) },
      { label: 'Copy to…', icon: 'i-lucide-copy', onSelect: () => startPicker('copy', [entry.path]) },
      { label: 'Share link', icon: 'i-lucide-link', onSelect: () => openShare(entry) },
      { label: 'Move to trash', icon: 'i-lucide-trash', color: 'error', onSelect: () => trash([entry.path]) }
    )
  }

  return items
}

const selectionActions = computed<DriveSelectionAction[]>(() => {
  const actions: DriveSelectionAction[] = [
    { key: 'download', label: 'Download', icon: 'i-lucide-download' }
  ]

  if (section.value.key === 'trash') {
    actions.push(
      { key: 'restore', label: 'Restore', icon: 'i-lucide-rotate-ccw' },
      { key: 'delete-forever', label: 'Delete permanently', icon: 'i-lucide-trash-2', color: 'error' }
    )
  } else {
    actions.push(
      { key: 'move', label: 'Move to…', icon: 'i-lucide-folder-input' },
      { key: 'copy', label: 'Copy to…', icon: 'i-lucide-copy' }
    )
    if (selectedEntries.value.length === 1) {
      actions.push({ key: 'share', label: 'Share link', icon: 'i-lucide-link' })
    }
    actions.push({ key: 'trash', label: 'Move to trash', icon: 'i-lucide-trash', color: 'error' })
  }

  return actions
})

function runSelectionAction(key: string) {
  const paths = selection.selected.value

  switch (key) {
    case 'download':
      download(paths)
      break
    case 'restore':
      restore(paths)
      break
    case 'delete-forever':
      askConfirm('Delete permanently?', `${selection.count.value} items will be removed forever.`, 'Delete', () => removeForever(paths))
      break
    case 'move':
      startPicker('move', paths)
      break
    case 'copy':
      startPicker('copy', paths)
      break
    case 'share':
      if (selectedEntries.value[0]) {
        openShare(selectedEntries.value[0])
      }
      break
    case 'trash':
      trash(paths)
      break
  }
}

useEventListener('keydown', (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
    return
  }
  if (event.key === 'Escape') {
    selection.clear()
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    selection.selectAll(visiblePaths.value)
  } else if (event.key === 'Delete' && selection.count.value) {
    trash(selection.selected.value)
  }
})
</script>

<template>
  <UDashboardPanel id="drive">
    <UDashboardNavbar :title="section.label">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>

      <template #trailing>
        <UBadge v-if="entries.length" :label="entries.length" variant="subtle" />
      </template>

      <template #right>
        <UTabs
          v-model="activeSection"
          :items="sectionTabs"
          :content="false"
          size="xs"
        />
      </template>
    </UDashboardNavbar>

    <UDashboardToolbar>
      <DriveSelectionToolbar
        v-if="selection.count.value"
        :count="selection.count.value"
        :actions="selectionActions"
        @action="runSelectionAction"
        @clear="selection.clear()"
      />

      <template v-else>
        <DriveBreadcrumb
          :path="path"
          :section="section"
          class="min-w-0 flex-1"
          @navigate="navigate"
        />

        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search this folder..."
          size="sm"
          class="hidden max-w-56 sm:block"
        >
          <template v-if="search" #trailing>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="link"
              size="xs"
              aria-label="Clear search"
              @click="search = ''"
            />
          </template>
        </UInput>

        <UTooltip text="New folder">
          <UButton
            icon="i-lucide-folder-plus"
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="section.key === 'trash'"
            @click="newFolderOpen = true"
          />
        </UTooltip>

        <UTooltip text="Upload files">
          <UButton
            icon="i-lucide-upload"
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="section.key === 'trash'"
            @click="pickFiles"
          />
        </UTooltip>
        <input
          ref="fileInput"
          type="file"
          multiple
          class="hidden"
          @change="onFilePicked"
        >

        <UDropdownMenu :items="sortItems">
          <UButton
            icon="i-lucide-arrow-up-down"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Sort"
          />
        </UDropdownMenu>

        <UTooltip :text="order === 'asc' ? 'Ascending' : 'Descending'">
          <UButton
            :icon="order === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="updateQuery({ order: order === 'asc' ? 'desc' : null })"
          />
        </UTooltip>

        <UTooltip text="Grid view">
          <UButton
            icon="i-lucide-layout-grid"
            :color="view === 'grid' ? 'primary' : 'neutral'"
            :variant="view === 'grid' ? 'soft' : 'ghost'"
            size="sm"
            aria-label="Grid view"
            @click="updateQuery({ view: null })"
          />
        </UTooltip>
        <UTooltip text="List view">
          <UButton
            icon="i-lucide-list"
            :color="view === 'list' ? 'primary' : 'neutral'"
            :variant="view === 'list' ? 'soft' : 'ghost'"
            size="sm"
            aria-label="List view"
            @click="updateQuery({ view: 'list' })"
          />
        </UTooltip>

        <UTooltip text="Refresh">
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            size="sm"
            :loading="status === 'pending'"
            @click="refresh()"
          />
        </UTooltip>
      </template>
    </UDashboardToolbar>

    <div v-if="upload.uploads.value.length" class="space-y-2 border-b border-default px-4 py-2">
      <div v-for="job in upload.uploads.value" :key="job.id" class="space-y-1">
        <div class="flex justify-between text-xs">
          <span class="truncate">{{ job.name }}</span>
          <span class="text-dimmed">{{ Math.round(job.progress * 100) }}%</span>
        </div>
        <UProgress :model-value="job.progress * 100" />
      </div>
    </div>

    <div v-if="section.listsInvitations && invitations.length" class="divide-y divide-default border-b border-default">
      <div v-for="invitation in invitations" :key="invitation.uid" class="flex items-center justify-between gap-3 px-4 py-2">
        <div class="flex min-w-0 items-center gap-3">
          <UIcon name="i-lucide-mail" class="size-4 shrink-0 text-muted" />
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">
              {{ invitation.name }}
            </p>
            <p v-if="invitation.from" class="truncate text-xs text-dimmed">
              from {{ invitation.from }}
            </p>
          </div>
        </div>
        <div class="flex shrink-0 gap-1">
          <UButton label="Accept" size="xs" @click="respondInvitation(invitation, true)" />
          <UButton
            label="Decline"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="respondInvitation(invitation, false)"
          />
        </div>
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Could not load the folder"
      :description="error.statusMessage || error.message"
      :actions="[{ label: 'Account settings', to: `/services/${service}`, color: 'error', variant: 'outline' }]"
      class="m-4 w-auto"
    />

    <DriveEntries
      v-else
      v-model:rename-path="renamePath"
      :entries="visible"
      :selected="selection.selected.value"
      :view="view"
      :service="service"
      :loading="loading"
      :menu-items="menuItems"
      @open="open"
      @select="(entry, mode) => selection.select(entry.path, mode, visiblePaths)"
      @clear="selection.clear()"
      @rename="rename"
      @drag-start="onDragStart"
      @drop-on="onDropOn"
      @drop-files="files => uploadTo(path, files)"
      @prefetch="prefetch"
    />

    <template #footer>
      <div v-if="section.emptyable && entries.length" class="flex justify-end border-t border-default px-4 py-2">
        <UButton
          label="Empty trash"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="sm"
          @click="askConfirm('Empty the trash?', 'Everything in the trash will be removed forever.', 'Empty trash', emptyTrash)"
        />
      </div>
    </template>
  </UDashboardPanel>

  <DriveDetails
    v-model:open="detailsOpen"
    :entry="detailEntry"
    :service="service"
    @download="detailEntry && download([detailEntry.path])"
    @share="detailEntry && openShare(detailEntry)"
  />

  <DriveShareDialog
    v-model:open="shareOpen"
    :entry="shareEntry"
    :service="service"
  />

  <DriveFolderPicker
    v-model:open="pickerOpen"
    :service="service"
    :title="pickerMode === 'move' ? 'Move to folder' : 'Copy to folder'"
    :confirm-label="pickerMode === 'move' ? 'Move here' : 'Copy here'"
    :exclude="pickerMode === 'move' ? pickerSource : []"
    @select="onPicked"
  />

  <UModal v-model:open="newFolderOpen" title="New folder">
    <template #body>
      <UFormField label="Name" required>
        <UInput
          v-model="newFolderName"
          autofocus
          class="w-full"
          @keydown.enter="confirmNewFolder"
        />
      </UFormField>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="newFolderOpen = false"
        />
        <UButton
          label="Create"
          icon="i-lucide-folder-plus"
          :disabled="!newFolderName.trim()"
          @click="confirmNewFolder"
        />
      </div>
    </template>
  </UModal>

  <UModal v-model:open="confirmState.open" :title="confirmState.title">
    <template #body>
      <p class="text-sm text-muted">
        {{ confirmState.description }}
      </p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="confirmState.open = false"
        />
        <UButton :label="confirmState.confirmLabel" color="error" @click="runConfirm" />
      </div>
    </template>
  </UModal>
</template>
