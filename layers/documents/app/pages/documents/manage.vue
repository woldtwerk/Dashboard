<script setup lang="ts">
import type { DocumentsCustomFieldType } from '#layers/documents/shared/types/documents'

useSeoMeta({ title: 'Manage documents' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

const service = computed(() => typeof route.query.service === 'string' ? route.query.service : '')

const library = useDocumentsLibrary(service)
watch(service, () => library.load(), { immediate: true })

interface ManageItem {
  id: number
  name: string
  documentCount: number
  match?: string
  matchingAlgorithm?: number
  isInsensitive?: boolean
  color?: string
  isInboxTag?: boolean
  path?: string
  dataType?: string
}

interface Draft {
  name: string
  match: string
  matchingAlgorithm: number
  isInsensitive: boolean
  color: string
  isInboxTag: boolean
  path: string
  dataType: DocumentsCustomFieldType
}

type DataKey = 'tags' | 'correspondents' | 'documentTypes' | 'storagePaths' | 'customFields'

interface Resource {
  key: string
  label: string
  icon: string
  endpoint: string
  dataKey: DataKey
  hasMatch: boolean
  hasColor?: boolean
  hasPath?: boolean
  hasDataType?: boolean
}

const RESOURCES: Resource[] = [
  { key: 'tags', label: 'Tags', icon: 'i-lucide-tag', endpoint: 'tags', dataKey: 'tags', hasMatch: true, hasColor: true },
  { key: 'correspondents', label: 'Correspondents', icon: 'i-lucide-users', endpoint: 'correspondents', dataKey: 'correspondents', hasMatch: true },
  { key: 'document-types', label: 'Document types', icon: 'i-lucide-file-type', endpoint: 'document-types', dataKey: 'documentTypes', hasMatch: true },
  { key: 'storage-paths', label: 'Storage paths', icon: 'i-lucide-folder-tree', endpoint: 'storage-paths', dataKey: 'storagePaths', hasMatch: true, hasPath: true },
  { key: 'custom-fields', label: 'Custom fields', icon: 'i-lucide-list-plus', endpoint: 'custom-fields', dataKey: 'customFields', hasMatch: false, hasDataType: true }
]

const MATCHING_ALGORITHMS = [
  { label: 'None', value: 0 },
  { label: 'Any word', value: 1 },
  { label: 'All words', value: 2 },
  { label: 'Exact match', value: 3 },
  { label: 'Regular expression', value: 4 },
  { label: 'Fuzzy word', value: 5 },
  { label: 'Automatic', value: 6 }
]

const DATA_TYPES: { label: string, value: DocumentsCustomFieldType }[] = [
  { label: 'Text', value: 'string' },
  { label: 'Long text', value: 'longtext' },
  { label: 'URL', value: 'url' },
  { label: 'Date', value: 'date' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Integer', value: 'integer' },
  { label: 'Float', value: 'float' },
  { label: 'Monetary', value: 'monetary' },
  { label: 'Document link', value: 'documentlink' },
  { label: 'Select', value: 'select' }
]

const activeKey = computed(() => {
  const tab = typeof route.query.tab === 'string' ? route.query.tab : ''
  return RESOURCES.some(item => item.key === tab) ? tab : RESOURCES[0]!.key
})
const resource = computed(() => RESOURCES.find(item => item.key === activeKey.value)!)

const tabItems = computed(() => RESOURCES.map(item => ({ label: item.label, value: item.key, icon: item.icon })))

const items = computed<ManageItem[]>(() => {
  const lists: Record<DataKey, ManageItem[]> = {
    tags: library.tags.data.value,
    correspondents: library.correspondents.data.value,
    documentTypes: library.documentTypes.data.value,
    storagePaths: library.storagePaths.data.value,
    customFields: library.customFields.data.value
  }
  return lists[resource.value.dataKey]
})

function refresh() {
  switch (resource.value.dataKey) {
    case 'tags': return library.tags.refresh()
    case 'correspondents': return library.correspondents.refresh()
    case 'documentTypes': return library.documentTypes.refresh()
    case 'storagePaths': return library.storagePaths.refresh()
    case 'customFields': return library.customFields.refresh()
  }
}

const editorOpen = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)

const draft = reactive<Draft>({
  name: '',
  match: '',
  matchingAlgorithm: 1,
  isInsensitive: true,
  color: '#3b82f6',
  isInboxTag: false,
  path: '',
  dataType: 'string'
})

function openCreate() {
  Object.assign(draft, { name: '', match: '', matchingAlgorithm: 1, isInsensitive: true, color: '#3b82f6', isInboxTag: false, path: '', dataType: 'string' })
  editingId.value = null
  editorOpen.value = true
}

function openEdit(item: ManageItem) {
  Object.assign(draft, {
    name: item.name,
    match: item.match ?? '',
    matchingAlgorithm: item.matchingAlgorithm ?? 1,
    isInsensitive: item.isInsensitive ?? true,
    color: item.color ?? '#3b82f6',
    isInboxTag: item.isInboxTag ?? false,
    path: item.path ?? '',
    dataType: (item.dataType as DocumentsCustomFieldType) ?? 'string'
  })
  editingId.value = item.id
  editorOpen.value = true
}

function buildBody(): Record<string, unknown> {
  const current = resource.value
  if (current.hasDataType) {
    return { name: draft.name.trim(), dataType: draft.dataType }
  }
  const body: Record<string, unknown> = {
    name: draft.name.trim(),
    match: draft.match.trim(),
    matchingAlgorithm: draft.matchingAlgorithm,
    isInsensitive: draft.isInsensitive
  }
  if (current.hasColor) {
    body.color = draft.color
    body.isInboxTag = draft.isInboxTag
  }
  if (current.hasPath) {
    body.path = draft.path.trim()
  }
  return body
}

async function save() {
  saving.value = true
  try {
    const endpoint = `/api/documents/${resource.value.endpoint}`
    if (editingId.value !== null) {
      await documentsRequest(`${endpoint}/${editingId.value}`, { method: 'PATCH', query: { service: service.value }, body: buildBody() })
    } else {
      await documentsRequest(endpoint, { method: 'POST', query: { service: service.value }, body: buildBody() })
    }
    editorOpen.value = false
    await refresh()
  } catch (failure) {
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not save', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    saving.value = false
  }
}

async function remove(item: ManageItem) {
  try {
    await documentsRequest(`/api/documents/${resource.value.endpoint}/${item.id}`, { method: 'DELETE', query: { service: service.value } })
    await refresh()
  } catch (failure) {
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not delete', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

const deleteTarget = ref<ManageItem | null>(null)

async function confirmRemove() {
  const target = deleteTarget.value
  deleteTarget.value = null
  if (target) {
    await remove(target)
  }
}
</script>

<template>
  <UDashboardPanel id="documents-manage">
    <UDashboardNavbar title="Manage documents">
      <template #leading>
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          :to="`/documents?service=${encodeURIComponent(service)}`"
          aria-label="Back to documents"
        />
      </template>
    </UDashboardNavbar>

    <div class="border-b border-default px-4 pt-2">
      <UTabs
        :model-value="activeKey"
        :items="tabItems"
        :content="false"
        size="sm"
        @update:model-value="value => router.replace({ query: { service, tab: String(value) } })"
      />
    </div>

    <div class="flex items-center justify-between gap-2 p-4">
      <p class="text-sm text-muted">
        {{ items.length }} {{ resource.label.toLowerCase() }}
      </p>
      <UButton
        :label="`Add ${resource.label.replace(/s$/, '')}`"
        icon="i-lucide-plus"
        size="sm"
        @click="openCreate"
      />
    </div>

    <div class="flex-1 overflow-auto px-4 pb-4">
      <table class="w-full text-sm">
        <thead class="text-xs text-muted">
          <tr class="border-b border-default">
            <th class="p-2 text-left font-medium">
              Name
            </th>
            <th v-if="resource.hasMatch" class="hidden p-2 text-left font-medium md:table-cell">
              Match
            </th>
            <th v-if="resource.hasPath" class="hidden p-2 text-left font-medium md:table-cell">
              Path
            </th>
            <th v-if="resource.hasDataType" class="hidden p-2 text-left font-medium md:table-cell">
              Type
            </th>
            <th class="p-2 text-left font-medium">
              Documents
            </th>
            <th class="p-2" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" class="border-b border-default/60">
            <td class="p-2">
              <div class="flex items-center gap-2">
                <span v-if="item.color" class="size-3 rounded-full" :style="{ backgroundColor: item.color }" />
                <span class="font-medium">{{ item.name }}</span>
                <UBadge
                  v-if="item.isInboxTag"
                  size="sm"
                  variant="subtle"
                  color="primary"
                >
                  Inbox
                </UBadge>
              </div>
            </td>
            <td v-if="resource.hasMatch" class="hidden p-2 text-muted md:table-cell">
              {{ item.match || '—' }}
            </td>
            <td v-if="resource.hasPath" class="hidden p-2 text-muted md:table-cell">
              {{ item.path || '—' }}
            </td>
            <td v-if="resource.hasDataType" class="hidden p-2 text-muted md:table-cell">
              {{ item.dataType || '—' }}
            </td>
            <td class="p-2 text-muted">
              {{ item.documentCount }}
            </td>
            <td class="p-2">
              <div class="flex justify-end gap-1">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  aria-label="Edit"
                  @click="openEdit(item)"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  aria-label="Delete"
                  @click="deleteTarget = item"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UDashboardPanel>

  <UModal v-model:open="editorOpen" :title="editingId === null ? `Add ${resource.label.replace(/s$/, '')}` : `Edit ${resource.label.replace(/s$/, '')}`">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Name" required>
          <UInput v-model="draft.name" autofocus class="w-full" />
        </UFormField>

        <UFormField v-if="resource.hasDataType" label="Data type">
          <USelect v-model="draft.dataType" :items="DATA_TYPES" class="w-full" />
        </UFormField>

        <UFormField v-if="resource.hasPath" label="Path" description="May use placeholders like {{ created_year }}">
          <UInput v-model="draft.path" class="w-full" />
        </UFormField>

        <template v-if="resource.hasMatch">
          <UFormField label="Match">
            <UInput v-model="draft.match" class="w-full" />
          </UFormField>
          <UFormField label="Matching algorithm">
            <USelect v-model="draft.matchingAlgorithm" :items="MATCHING_ALGORITHMS" class="w-full" />
          </UFormField>
          <USwitch v-model="draft.isInsensitive" label="Case insensitive" />
        </template>

        <template v-if="resource.hasColor">
          <UFormField label="Colour">
            <input v-model="draft.color" type="color" class="h-9 w-full cursor-pointer rounded">
          </UFormField>
          <USwitch v-model="draft.isInboxTag" label="Inbox tag (new documents get it)" />
        </template>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="editorOpen = false"
        />
        <UButton
          label="Save"
          icon="i-lucide-save"
          :disabled="!draft.name.trim()"
          :loading="saving"
          @click="save"
        />
      </div>
    </template>
  </UModal>

  <UModal :open="!!deleteTarget" title="Delete" @update:open="value => { if (!value) deleteTarget = null }">
    <template #body>
      <p class="text-sm text-muted">
        "{{ deleteTarget?.name }}" will be removed. Documents using it keep their other metadata.
      </p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="deleteTarget = null"
        />
        <UButton label="Delete" color="error" @click="confirmRemove" />
      </div>
    </template>
  </UModal>
</template>
