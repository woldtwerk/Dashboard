<script setup lang="ts">
import type { DocumentsDocument, DocumentsDocumentPatch, DocumentsHistoryEntry, DocumentsMetadata, DocumentsNote, DocumentsShareLink, DocumentsSuggestions } from '#layers/documents/shared/types/documents'
import { documentKindLabel, formatBytes, formatDateTime, isInlinePreview } from '#layers/documents/shared/documents-format'

useSeoMeta({ title: 'Document' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

const service = typeof route.query.service === 'string' ? route.query.service : ''
const id = Number(route.params.id)

if (!service || !Number.isInteger(id)) {
  throw createError({ statusCode: 404, statusMessage: 'Document not found', fatal: true })
}

const { cached, remember } = useDocumentsPrefetch()

const { data: document, error } = await useFetch<DocumentsDocument>(`/api/documents/${id}`, {
  query: { service },
  default: () => cached(service, id)!
})

if (!document.value) {
  throw createError({ statusCode: 404, statusMessage: 'Document not found', fatal: true })
}

const library = useDocumentsLibrary(ref(service))
const { tagList, correspondentList, documentTypeList, storagePathList, customFieldList } = library
library.load()

const { data: notes, refresh: refreshNotes } = await useFetch<DocumentsNote[]>(`/api/documents/${id}/notes`, { query: { service }, default: () => [] })
const { data: suggestions } = await useFetch<DocumentsSuggestions>(`/api/documents/${id}/suggestions`, { query: { service }, default: () => ({ correspondents: [], tags: [], documentTypes: [], storagePaths: [], dates: [] }) })
const { data: history } = await useFetch<DocumentsHistoryEntry[]>(`/api/documents/${id}/history`, { query: { service }, default: () => [] })
const { data: shareLinks, refresh: refreshShareLinks } = await useFetch<DocumentsShareLink[]>(`/api/documents/${id}/share-links`, { query: { service }, default: () => [] })
const { data: metadata } = await useFetch<DocumentsMetadata>(`/api/documents/${id}/metadata`, { query: { service } })

const previewUrl = computed(() => documentsFileUrl('preview', service, id))
const inline = computed(() => isInlinePreview(document.value?.mimeType ?? ''))
const image = computed(() => (document.value?.mimeType ?? '').startsWith('image/'))

const saving = ref(false)

// Optimistic metadata edit: show the patch at once, roll back if the server rejects it
async function applyPatch(patch: DocumentsDocumentPatch, label: string) {
  const previous = document.value!
  document.value = { ...previous, ...patch }
  saving.value = true
  try {
    const updated = await documentsRequest<DocumentsDocument>(`/api/documents/${id}`, { method: 'PATCH', query: { service }, body: patch })
    document.value = updated
    remember(service, id, updated)
    toast.add({ title: label, color: 'success', icon: 'i-lucide-check-circle' })
  } catch (failure) {
    document.value = previous
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not save the change', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    saving.value = false
  }
}

function applySuggestion(patch: DocumentsDocumentPatch) {
  applyPatch(patch, 'Suggestion applied')
}

const noteText = ref('')

async function addNote() {
  const note = noteText.value.trim()
  if (!note) {
    return
  }
  noteText.value = ''
  try {
    notes.value = await documentsRequest<DocumentsNote[]>(`/api/documents/${id}/notes`, { method: 'POST', query: { service }, body: { note } })
  } catch (failure) {
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not add the note', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

async function removeNote(note: DocumentsNote) {
  const previous = notes.value
  notes.value = previous.filter(item => item.id !== note.id)
  try {
    await documentsRequest(`/api/documents/${id}/notes`, { method: 'DELETE', query: { service, noteId: note.id } })
  } catch (failure) {
    notes.value = previous
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not delete the note', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

const shareOpen = ref(false)
const shareVersion = ref<'archive' | 'original'>('archive')

async function createShareLink() {
  shareOpen.value = false
  try {
    await documentsRequest(`/api/documents/${id}/share-links`, { method: 'POST', query: { service }, body: { fileVersion: shareVersion.value } })
    await refreshShareLinks()
  } catch (failure) {
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not create the share link', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

async function removeShareLink(link: DocumentsShareLink) {
  try {
    await documentsRequest(`/api/documents/${id}/share-links/${link.id}`, { method: 'DELETE', query: { service } })
    await refreshShareLinks()
  } catch (failure) {
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not remove the share link', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function download(original: boolean) {
  window.location.href = documentsFileUrl('download', service, id, { original })
}

const deleteOpen = ref(false)

async function removeDocument() {
  deleteOpen.value = false
  try {
    await documentsRequest(`/api/documents/${id}`, { method: 'DELETE', query: { service } })
    await router.push({ path: '/documents', query: { service } })
  } catch (failure) {
    toast.add({ title: failure instanceof Error ? failure.message : 'Could not delete the document', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}
</script>

<template>
  <UDashboardPanel id="document">
    <UDashboardNavbar :title="document!.title">
      <template #leading>
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          :to="`/documents?service=${encodeURIComponent(service)}`"
          aria-label="Back to documents"
        />
      </template>

      <template #right>
        <UButton
          label="Original"
          icon="i-lucide-download"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="download(true)"
        />
        <UButton
          v-if="metadata?.hasArchiveVersion"
          label="Archived"
          icon="i-lucide-download"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="download(false)"
        />
        <UButton
          label="Share"
          icon="i-lucide-link"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="shareOpen = true"
        />
        <UButton
          label="Delete"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="sm"
          @click="deleteOpen = true"
        />
      </template>
    </UDashboardNavbar>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Could not load the document"
      :description="error.statusMessage || error.message"
      class="m-4 w-auto"
    />

    <div v-else class="grid gap-6 p-4 lg:grid-cols-2">
      <div class="space-y-4">
        <UCard>
          <div v-if="inline && image">
            <img :src="previewUrl" :alt="document!.title" class="mx-auto max-h-[80vh] w-auto rounded">
          </div>
          <iframe
            v-else-if="inline"
            :src="previewUrl"
            :title="document!.title"
            class="h-[80vh] w-full rounded border border-default"
          />
          <div v-else class="flex flex-col items-center gap-3 py-12 text-center">
            <UIcon name="i-lucide-file" class="size-10 text-dimmed" />
            <p class="text-sm text-muted">
              {{ documentKindLabel(document!.mimeType) }} — no inline preview.
            </p>
            <UButton label="Download original" icon="i-lucide-download" @click="download(true)" />
          </div>
        </UCard>

        <UCard v-if="metadata">
          <template #header>
            <h3 class="text-sm font-medium">
              Details
            </h3>
          </template>
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt class="text-muted">
              Original
            </dt>
            <dd>{{ metadata.originalFilename }} · {{ formatBytes(metadata.originalSize) }}</dd>
            <template v-if="metadata.hasArchiveVersion">
              <dt class="text-muted">
                Archived
              </dt>
              <dd>{{ metadata.archiveFilename }} · {{ formatBytes(metadata.archiveSize) }}</dd>
            </template>
            <dt class="text-muted">
              Pages
            </dt>
            <dd>{{ document!.pageCount ?? '—' }}</dd>
            <dt class="text-muted">
              Added
            </dt>
            <dd>{{ formatDateTime(document!.added) }}</dd>
            <dt class="text-muted">
              Modified
            </dt>
            <dd>{{ formatDateTime(document!.modified) }}</dd>
          </dl>
        </UCard>

        <UCard v-if="history?.length">
          <template #header>
            <h3 class="text-sm font-medium">
              History
            </h3>
          </template>
          <ul class="space-y-2 text-sm">
            <li v-for="entry in history" :key="entry.id" class="flex gap-3">
              <UIcon name="i-lucide-history" class="mt-0.5 size-4 shrink-0 text-dimmed" />
              <div>
                <p class="font-medium">
                  {{ entry.action }}
                </p>
                <p class="text-xs text-muted">
                  {{ formatDateTime(entry.timestamp) }}<template v-if="entry.actor">
                    · {{ entry.actor }}
                  </template>
                </p>
              </div>
            </li>
          </ul>
        </UCard>
      </div>

      <div class="space-y-4">
        <UCard v-if="suggestions && (suggestions.correspondents.length || suggestions.tags.length || suggestions.documentTypes.length || suggestions.storagePaths.length || suggestions.dates.length)">
          <template #header>
            <h3 class="text-sm font-medium">
              Suggestions
            </h3>
          </template>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="item in suggestions.correspondents"
              :key="`c-${item.id}`"
              :label="item.name"
              icon="i-lucide-user"
              size="xs"
              color="neutral"
              variant="subtle"
              @click="applySuggestion({ correspondent: item.id })"
            />
            <UButton
              v-for="item in suggestions.documentTypes"
              :key="`t-${item.id}`"
              :label="item.name"
              icon="i-lucide-file-type"
              size="xs"
              color="neutral"
              variant="subtle"
              @click="applySuggestion({ documentType: item.id })"
            />
            <UButton
              v-for="item in suggestions.storagePaths"
              :key="`p-${item.id}`"
              :label="item.name"
              icon="i-lucide-folder-tree"
              size="xs"
              color="neutral"
              variant="subtle"
              @click="applySuggestion({ storagePath: item.id })"
            />
            <UButton
              v-for="tag in suggestions.tags"
              :key="`g-${tag.id}`"
              :label="tag.name"
              icon="i-lucide-tag"
              size="xs"
              color="neutral"
              variant="subtle"
              @click="applySuggestion({ tags: [...new Set([...document!.tags, tag.id])] })"
            />
            <UButton
              v-for="date in suggestions.dates"
              :key="`d-${date}`"
              :label="date"
              icon="i-lucide-calendar"
              size="xs"
              color="neutral"
              variant="subtle"
              @click="applySuggestion({ created: date })"
            />
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h3 class="text-sm font-medium">
              Metadata
            </h3>
          </template>
          <DocumentsMetadataForm
            :document="document!"
            :tags="tagList"
            :correspondents="correspondentList"
            :document-types="documentTypeList"
            :storage-paths="storagePathList"
            :custom-fields="customFieldList"
            :saving="saving"
            @save="patch => applyPatch(patch, 'Document updated')"
          />
        </UCard>

        <UCard>
          <template #header>
            <h3 class="text-sm font-medium">
              Notes
            </h3>
          </template>
          <div class="space-y-3">
            <div v-if="notes?.length" class="space-y-2">
              <div v-for="note in notes" :key="note.id" class="rounded-lg border border-default p-3">
                <div class="flex items-start justify-between gap-2">
                  <p class="whitespace-pre-wrap text-sm">
                    {{ note.note }}
                  </p>
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    aria-label="Delete note"
                    @click="removeNote(note)"
                  />
                </div>
                <p class="mt-1 text-xs text-dimmed">
                  {{ formatDateTime(note.created) }}
                </p>
              </div>
            </div>
            <p v-else class="text-sm text-muted">
              No notes yet.
            </p>

            <div class="flex gap-2">
              <UInput
                v-model="noteText"
                placeholder="Add a note…"
                class="flex-1"
                @keydown.enter="addNote"
              />
              <UButton
                label="Add"
                icon="i-lucide-plus"
                :disabled="!noteText.trim()"
                @click="addNote"
              />
            </div>
            <div class="flex justify-end">
              <UButton
                label="Refresh notes"
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="refreshNotes()"
              />
            </div>
          </div>
        </UCard>

        <UCard v-if="shareLinks?.length">
          <template #header>
            <h3 class="text-sm font-medium">
              Share links
            </h3>
          </template>
          <ul class="space-y-2 text-sm">
            <li v-for="link in shareLinks" :key="link.id" class="flex items-center justify-between gap-2 rounded-lg border border-default p-3">
              <div class="min-w-0">
                <p class="truncate font-mono text-xs">
                  {{ link.slug }}
                </p>
                <p class="text-xs text-dimmed">
                  {{ link.fileVersion }} · created {{ formatDateTime(link.created) }}
                </p>
              </div>
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                aria-label="Remove share link"
                @click="removeShareLink(link)"
              />
            </li>
          </ul>
        </UCard>
      </div>
    </div>
  </UDashboardPanel>

  <UModal v-model:open="shareOpen" title="Create share link">
    <template #body>
      <UFormField label="File version">
        <USelect
          v-model="shareVersion"
          :items="[{ label: 'Archived', value: 'archive' }, { label: 'Original', value: 'original' }]"
          class="w-full"
        />
      </UFormField>
      <p class="mt-2 text-sm text-muted">
        The link is served by the Paperless-ngx instance itself.
      </p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="shareOpen = false"
        />
        <UButton label="Create" icon="i-lucide-link" @click="createShareLink" />
      </div>
    </template>
  </UModal>

  <UModal v-model:open="deleteOpen" title="Delete document">
    <template #body>
      <p class="text-sm text-muted">
        "{{ document!.title }}" will be moved to the trash.
      </p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="deleteOpen = false"
        />
        <UButton label="Delete" color="error" @click="removeDocument" />
      </div>
    </template>
  </UModal>
</template>
