<script setup lang="ts">
import { refDebounced, useDebounceFn } from '@vueuse/core'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { DocumentsBulkAction, DocumentsDocument, DocumentsFilters, DocumentsPage, DocumentsSavedView } from '#layers/documents/shared/types/documents'
import { applyBulkAction } from '#layers/documents/shared/bulk-edit'
import { DEFAULT_PAGE_SIZE, DEFAULT_SORT, documentsQueryFromUrl, documentsQueryToUrl, documentsViewFromUrl, documentsViewToUrl, hasActiveFilters } from '#layers/documents/shared/documents-query'
import { documentsItemContext } from '#layers/documents/app/utils/documents-item-context'
import { documentsSelectionFromQuery, documentsSelectionToQuery, rangeDocumentSelection, toggleDocumentSelection } from '#layers/documents/app/utils/documents-selection'

useSeoMeta({ title: 'Documents' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

const { data: allServices } = await useServices()
const services = computed(() => allServices.value.filter(item => item.domain === 'documents'))

if (!services.value.length) {
  await navigateTo('/services/new', { replace: true })
}

const queryString = (key: string) => typeof route.query[key] === 'string' ? route.query[key] : undefined

const service = computed(() => services.value.find(item => item.id === queryString('service'))?.id ?? services.value[0]?.id ?? '')

const state = computed(() => documentsQueryFromUrl(route.query))
const view = computed(() => documentsViewFromUrl(route.query.view))
const filtersOpen = ref(hasActiveFilters(state.value.filters))

function clean(query: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(query)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => [key, String(value)]))
}

function updateQuery(patch: Record<string, string | null>) {
  router.replace({ query: clean({ ...route.query, ...patch, service: service.value }) })
}

const search = ref(queryString('q') ?? '')
const debouncedSearch = refDebounced(search, 300)
watch(debouncedSearch, value => updateQuery({ q: value.trim() || null, page: null }))
watch(() => queryString('q'), (value) => {
  if ((value ?? '') !== debouncedSearch.value.trim()) {
    search.value = value ?? ''
  }
})

const listParams = computed(() => clean({ service: service.value, ...documentsQueryToUrl(state.value) }))

const { data: page, status, error, refresh } = await useFetch<DocumentsPage<DocumentsDocument>>('/api/documents', {
  key: () => `documents:list:${service.value}`,
  query: listParams,
  default: () => ({ count: 0, page: 1, pageSize: state.value.pageSize, results: [] })
})

const documents = computed(() => page.value.results)

const refreshFromEvents = useDebounceFn(() => refresh(), 300)
useDomainEvents({ domains: ['documents'] }, (event) => {
  if (documentsRefreshFor(event)) {
    refreshFromEvents()
  }
}, {
  onReconnect: () => refreshFromEvents()
})

const library = useDocumentsLibrary(service)
const { tagList, correspondentList, documentTypeList, storagePathList, customFieldList } = library
watch(service, () => library.load(), { immediate: true })

const { prefetch } = useDocumentsPrefetch()

const tagName = (id: number) => documentsName(library.tags.data.value, id)
const tagColor = (id: number) => library.tags.data.value.find(tag => tag.id === id)?.color

// --- Navigation -----------------------------------------------------------

function open(document: DocumentsDocument) {
  router.push({ path: `/documents/${document.id}`, query: { service: service.value } })
}

// --- Filters --------------------------------------------------------------

const filters = computed({
  get: () => state.value.filters,
  set: (value: DocumentsFilters) => updateQuery({ ...documentsQueryToUrl({ ...state.value, filters: value }), page: null })
})

// --- Selection ------------------------------------------------------------

// Ordered document ids in `?sel=`, so the selection survives a reload and can be shared
const selected = computed({
  get: () => documentsSelectionFromQuery(route.query),
  set: (ids: number[]) => updateQuery({ sel: documentsSelectionToQuery(ids) })
})

/** The document a shift-click range grows from; UI state, the selection itself is URL state */
const selectionAnchor = ref<number | undefined>()

function select(document: DocumentsDocument, mode: 'replace' | 'toggle' | 'range') {
  if (mode === 'range') {
    selected.value = rangeDocumentSelection(documents.value.map(item => item.id), selectionAnchor.value, document.id)
  } else if (mode === 'toggle') {
    selected.value = toggleDocumentSelection(selected.value, document.id)
  } else {
    selected.value = [document.id]
  }

  selectionAnchor.value = document.id
}

// A changed account starts a fresh list, so a selection of the old one is dropped
watch(service, () => {
  if (selected.value.length) {
    selected.value = []
  }
})

/** The selected documents as item contexts, for the actions other layers registered */
const selectedContexts = computed(() => documents.value
  .filter(document => selected.value.includes(document.id))
  .map(document => documentsItemContext(document, service.value, {
    tag: id => documentsName(library.tags.data.value, id),
    correspondent: id => documentsName(library.correspondents.data.value, id),
    documentType: id => documentsName(library.documentTypes.data.value, id)
  })))

// --- Optimistic bulk edit -------------------------------------------------

async function runBulk(action: DocumentsBulkAction, request: () => Promise<unknown>, failureMessage: string) {
  const previous = documents.value
  page.value = { ...page.value, results: applyBulkAction(previous, selected.value, action) }
  try {
    await request()
    selected.value = []
    await refresh()
  } catch (failure) {
    page.value = { ...page.value, results: previous }
    toast.add({ title: failure instanceof Error ? failure.message : failureMessage, color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function bulkEdit(action: DocumentsBulkAction) {
  return runBulk(
    action,
    () => documentsRequest('/api/documents/bulk-edit', { method: 'POST', query: { service: service.value }, body: { documents: selected.value, action } }),
    'The bulk edit failed'
  )
}

async function downloadSelection() {
  try {
    const response = await fetch(`/api/documents/bulk-download?service=${encodeURIComponent(service.value)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documents: selected.value, content: 'both', compression: 'none' })
    })
    if (!response.ok) {
      throw new Error('The archive could not be created')
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'documents.zip'
    link.click()
    URL.revokeObjectURL(url)
  } catch (failure) {
    toast.add({ title: failure instanceof Error ? failure.message : 'Download failed', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function moreLikeThis() {
  if (selected.value.length !== 1) {
    return
  }
  updateQuery({ mlt: String(selected.value[0]), page: null })
  selected.value = []
}

function submenuItems(items: { label: string, value: number }[], onSelect: (value: number) => void): DropdownMenuItem[] {
  return items.map(item => ({ label: item.label, onSelect: () => onSelect(item.value) }))
}

const bulkItems = computed<DropdownMenuItem[]>(() => [
  {
    label: 'Add tag',
    icon: 'i-lucide-tag',
    children: submenuItems(library.tags.data.value.map(tag => ({ label: tag.name, value: tag.id })), tag => bulkEdit({ method: 'add_tag', tag }))
  },
  {
    label: 'Remove tag',
    icon: 'i-lucide-tag-off',
    children: submenuItems(library.tags.data.value.map(tag => ({ label: tag.name, value: tag.id })), tag => bulkEdit({ method: 'remove_tag', tag }))
  },
  {
    label: 'Set correspondent',
    icon: 'i-lucide-user',
    children: [
      { label: 'Clear', onSelect: () => bulkEdit({ method: 'set_correspondent', correspondent: null }) },
      ...submenuItems(library.correspondents.data.value.map(item => ({ label: item.name, value: item.id })), correspondent => bulkEdit({ method: 'set_correspondent', correspondent }))
    ]
  },
  {
    label: 'Set document type',
    icon: 'i-lucide-file-type',
    children: [
      { label: 'Clear', onSelect: () => bulkEdit({ method: 'set_document_type', documentType: null }) },
      ...submenuItems(library.documentTypes.data.value.map(item => ({ label: item.name, value: item.id })), documentType => bulkEdit({ method: 'set_document_type', documentType }))
    ]
  },
  {
    label: 'Set storage path',
    icon: 'i-lucide-folder-tree',
    children: [
      { label: 'Clear', onSelect: () => bulkEdit({ method: 'set_storage_path', storagePath: null }) },
      ...submenuItems(library.storagePaths.data.value.map(item => ({ label: item.name, value: item.id })), storagePath => bulkEdit({ method: 'set_storage_path', storagePath }))
    ]
  },
  { label: 'More like this', icon: 'i-lucide-sparkles', onSelect: moreLikeThis },
  { label: 'Reprocess', icon: 'i-lucide-refresh-cw', onSelect: () => bulkEdit({ method: 'reprocess' }) },
  {
    label: 'Rotate',
    icon: 'i-lucide-rotate-cw',
    children: [90, 180, 270].map(degrees => ({ label: `${degrees}°`, onSelect: () => bulkEdit({ method: 'rotate', degrees: degrees as 90 | 180 | 270 }) }))
  },
  { label: 'Merge', icon: 'i-lucide-git-merge', disabled: selected.value.length < 2, onSelect: () => bulkEdit({ method: 'merge', deleteOriginals: false }) },
  { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => bulkEdit({ method: 'delete' }) }
])

// --- Saved views ----------------------------------------------------------

const saveOpen = ref(false)
const viewName = ref('')

async function saveView() {
  const name = viewName.value.trim()
  saveOpen.value = false
  viewName.value = ''
  if (!name) {
    return
  }
  try {
    await documentsRequest('/api/documents/saved-views', {
      method: 'POST',
      query: { service: service.value },
      body: { name, reverse: state.value.order === 'desc', sort: state.value.sort, pageSize: state.value.pageSize, displayMode: view.value, filters: state.value.filters }
    })
    await library.savedViews.refresh()
  } catch (failure) {
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not save the view', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function applyView(saved: DocumentsSavedView) {
  const next = documentsQueryToUrl({
    page: 1,
    pageSize: saved.pageSize ?? DEFAULT_PAGE_SIZE,
    sort: saved.sort ?? DEFAULT_SORT,
    order: saved.reverse ? 'desc' : 'asc',
    filters: saved.filters
  })
  router.replace({ query: clean({ ...next, service: service.value, view: documentsViewToUrl(saved.displayMode ?? 'table') }) })
}

async function removeView(saved: DocumentsSavedView) {
  try {
    await documentsRequest(`/api/documents/saved-views/${saved.id}`, { method: 'DELETE', query: { service: service.value } })
    await library.savedViews.refresh()
  } catch (failure) {
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not delete the view', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

const activeViewId = ref<number | null>(null)

function openSaveView() {
  viewName.value = ''
  saveOpen.value = true
}

function useView(view: DocumentsSavedView) {
  activeViewId.value = view.id
  applyView(view)
}

const savedViewItems = computed<DropdownMenuItem[]>(() => [
  { label: 'Save current view', icon: 'i-lucide-bookmark-plus', onSelect: openSaveView },
  ...library.savedViews.data.value.map(view => ({
    label: view.name,
    icon: activeViewId.value === view.id ? 'i-lucide-check' : 'i-lucide-bookmark',
    onSelect: () => useView(view),
    children: [{ label: 'Delete view', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => removeView(view) }]
  }))
])
</script>

<template>
  <UDashboardPanel id="documents">
    <UDashboardNavbar title="Documents">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>

      <template #trailing>
        <UBadge v-if="page.count" :label="String(page.count)" variant="subtle" />
      </template>

      <template #right>
        <USelect
          v-if="services.length > 1"
          :model-value="service"
          :items="services.map(item => ({ label: item.name, value: item.id }))"
          size="xs"
          @update:model-value="value => updateQuery({ service: String(value) })"
        />
        <UButton
          label="Manage"
          icon="i-lucide-settings-2"
          color="neutral"
          variant="ghost"
          size="xs"
          :to="`/documents/manage?service=${encodeURIComponent(service)}`"
        />
      </template>
    </UDashboardNavbar>

    <UDashboardToolbar>
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search documents…"
        size="sm"
        class="min-w-40 flex-1"
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

      <UButton
        :label="filtersOpen || hasActiveFilters(state.filters) ? 'Filters' : 'Filters'"
        icon="i-lucide-filter"
        :color="hasActiveFilters(state.filters) ? 'primary' : 'neutral'"
        :variant="hasActiveFilters(state.filters) ? 'soft' : 'ghost'"
        size="sm"
        @click="filtersOpen = !filtersOpen"
      />

      <UDropdownMenu :items="savedViewItems">
        <UButton
          label="Views"
          icon="i-lucide-bookmark"
          color="neutral"
          variant="ghost"
          size="sm"
        />
      </UDropdownMenu>

      <UDropdownMenu :items="[{ label: 'Added', onSelect: () => updateQuery({ sort: null }) }, { label: 'Created', onSelect: () => updateQuery({ sort: 'created' }) }, { label: 'Title', onSelect: () => updateQuery({ sort: 'title' }) }, { label: 'Correspondent', onSelect: () => updateQuery({ sort: 'correspondent' }) }, { label: 'Document type', onSelect: () => updateQuery({ sort: 'document_type' }) }, { label: 'ASN', onSelect: () => updateQuery({ sort: 'archive_serial_number' }) }]">
        <UButton
          icon="i-lucide-arrow-up-down"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Sort"
        />
      </UDropdownMenu>

      <UTooltip :text="state.order === 'asc' ? 'Ascending' : 'Descending'">
        <UButton
          :icon="state.order === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="updateQuery({ order: state.order === 'asc' ? null : 'asc', page: null })"
        />
      </UTooltip>

      <UTooltip text="Table view">
        <UButton
          icon="i-lucide-list"
          :color="view === 'table' ? 'primary' : 'neutral'"
          :variant="view === 'table' ? 'soft' : 'ghost'"
          size="sm"
          aria-label="Table view"
          @click="updateQuery({ view: documentsViewToUrl('table') })"
        />
      </UTooltip>
      <UTooltip text="Grid view">
        <UButton
          icon="i-lucide-layout-grid"
          :color="view === 'grid' ? 'primary' : 'neutral'"
          :variant="view === 'grid' ? 'soft' : 'ghost'"
          size="sm"
          aria-label="Grid view"
          @click="updateQuery({ view: documentsViewToUrl('grid') })"
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
    </UDashboardToolbar>

    <div v-if="filtersOpen" class="border-b border-default p-4">
      <DocumentsFilters
        v-model="filters"
        :tags="tagList"
        :correspondents="correspondentList"
        :document-types="documentTypeList"
        :storage-paths="storagePathList"
        :custom-fields="customFieldList"
      />
    </div>

    <div v-if="state.moreLikeId" class="flex items-center gap-2 border-b border-default bg-elevated/50 px-4 py-2 text-sm">
      <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
      <span>Showing documents similar to #{{ state.moreLikeId }}</span>
      <UButton
        label="Clear"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="updateQuery({ mlt: null, page: null })"
      />
    </div>

    <div v-if="selected.length" class="flex flex-wrap items-center gap-2 border-b border-default px-4 py-2">
      <span class="text-sm font-medium">{{ selected.length }} selected</span>

      <UDropdownMenu :items="bulkItems">
        <UButton
          label="Bulk actions"
          icon="i-lucide-list-checks"
          color="neutral"
          variant="ghost"
          size="xs"
        />
      </UDropdownMenu>

      <ItemActionsMenu
        domain="documents"
        :service="service"
        :contexts="selectedContexts"
        icon="i-lucide-workflow"
        size="xs"
      />

      <UButton
        label="Download zip"
        icon="i-lucide-download"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="downloadSelection"
      />

      <UButton
        label="Clear"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="selected = []"
      />
    </div>

    <div class="border-b border-default p-4">
      <DocumentsUploader :service="service" @done="refresh()" />
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Could not load the documents"
      :description="error.statusMessage || error.message"
      :actions="[{ label: 'Account settings', to: `/services/${service}`, color: 'error', variant: 'outline' }]"
      class="m-4 w-auto"
    />

    <DocumentsEntries
      v-else
      :documents="documents"
      :view="view"
      :service="service"
      :selected="selected"
      :loading="status === 'pending'"
      :tag-name="tagName"
      :tag-color="tagColor"
      @open="open"
      @select="select"
      @prefetch="document => prefetch(service, document.id)"
    />

    <template #footer>
      <div class="flex justify-end border-t border-default px-4 py-2">
        <UPagination
          :page="state.page"
          :items-per-page="state.pageSize"
          :total="page.count"
          :sibling-count="1"
          show-edges
          @update:page="value => updateQuery({ page: value === 1 ? null : String(value) })"
        />
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="saveOpen" title="Save view">
    <template #body>
      <UFormField label="Name" required>
        <UInput
          v-model="viewName"
          autofocus
          class="w-full"
          @keydown.enter="saveView"
        />
      </UFormField>
      <p class="mt-2 text-sm text-muted">
        Saves the current filters, sort and view.
      </p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="saveOpen = false"
        />
        <UButton
          label="Save"
          icon="i-lucide-bookmark-plus"
          :disabled="!viewName.trim()"
          @click="saveView"
        />
      </div>
    </template>
  </UModal>
</template>
