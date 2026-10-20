<script setup lang="ts">
import type { DocumentsDocument } from '#layers/documents/shared/types/documents'
import { documentIcon, formatDate } from '#layers/documents/shared/documents-format'
import { highlightToHtml } from '#layers/core/shared/highlight'

const props = defineProps<{
  documents: DocumentsDocument[]
  view: 'table' | 'grid'
  service: string
  selected: number[]
  loading?: boolean
  tagName: (id: number) => string
  tagColor: (id: number) => string | undefined
}>()

const emit = defineEmits<{
  open: [document: DocumentsDocument]
  select: [document: DocumentsDocument, mode: 'replace' | 'toggle' | 'range']
  prefetch: [document: DocumentsDocument]
}>()

function thumb(document: DocumentsDocument): string {
  return documentsFileUrl('thumb', props.service, document.id)
}

function isSelected(id: number): boolean {
  return props.selected.includes(id)
}

function onSelect(document: DocumentsDocument, event: MouseEvent, forced?: 'replace' | 'toggle' | 'range') {
  const mode = event.shiftKey ? 'range' : forced ?? (event.metaKey || event.ctrlKey ? 'toggle' : 'replace')
  emit('select', document, mode)
}

/** A modifier click selects, a plain click opens as before */
function onRowClick(document: DocumentsDocument, event: MouseEvent) {
  if (event.shiftKey || event.metaKey || event.ctrlKey) {
    onSelect(document, event)
    return
  }
  emit('open', document)
}
</script>

<template>
  <div v-if="loading && !documents.length" class="flex flex-1 items-center justify-center p-10">
    <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-dimmed" />
  </div>

  <UEmpty
    v-else-if="!documents.length"
    icon="i-lucide-file-search"
    title="No documents"
    description="Nothing matches the current filters."
    class="flex-1"
  />

  <div v-else-if="view === 'grid'" class="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
    <button
      v-for="document in documents"
      :key="document.id"
      type="button"
      class="group flex flex-col overflow-hidden rounded-lg border text-left transition"
      :class="isSelected(document.id) ? 'border-primary ring-2 ring-primary' : 'border-default hover:border-primary/50'"
      @click="onRowClick(document, $event)"
      @mouseenter="emit('prefetch', document)"
    >
      <div class="relative flex aspect-[3/4] items-center justify-center overflow-hidden bg-elevated/50">
        <img
          :src="thumb(document)"
          :alt="document.title"
          loading="lazy"
          class="size-full object-cover object-top"
        >
        <UCheckbox
          class="absolute end-2 top-2"
          :model-value="isSelected(document.id)"
          @click.stop="onSelect(document, $event, 'toggle')"
        />
      </div>
      <div class="flex flex-col gap-1 p-3">
        <p class="line-clamp-2 text-sm font-medium">
          {{ document.title }}
        </p>
        <!-- eslint-disable-next-line vue/no-v-html -- highlightToHtml escapes the excerpt -->
        <p v-if="document.snippet" class="line-clamp-2 text-xs text-muted" v-html="highlightToHtml(document.snippet)" />
        <p class="text-xs text-muted">
          {{ formatDate(document.created) }}
        </p>
        <div v-if="document.tags.length" class="flex flex-wrap gap-1">
          <UBadge
            v-for="tag in document.tags.slice(0, 3)"
            :key="tag"
            size="sm"
            variant="subtle"
            :style="tagColor(tag) ? { backgroundColor: tagColor(tag) } : undefined"
          >
            {{ tagName(tag) }}
          </UBadge>
        </div>
      </div>
    </button>
  </div>

  <div v-else class="flex-1 overflow-auto">
    <table class="w-full text-sm">
      <thead class="sticky top-0 z-10 bg-default text-xs text-muted">
        <tr class="border-b border-default">
          <th class="w-10 p-2" />
          <th class="w-14 p-2" />
          <th class="p-2 text-left font-medium">
            Title
          </th>
          <th class="hidden p-2 text-left font-medium lg:table-cell">
            Created
          </th>
          <th class="hidden p-2 text-left font-medium xl:table-cell">
            Added
          </th>
          <th class="hidden p-2 text-left font-medium 2xl:table-cell">
            ASN
          </th>
          <th class="hidden p-2 text-left font-medium xl:table-cell">
            Tags
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="document in documents"
          :key="document.id"
          class="cursor-pointer border-b border-default/60 hover:bg-elevated/50"
          :class="isSelected(document.id) ? 'bg-primary/5' : ''"
          @click="onRowClick(document, $event)"
          @mouseenter="emit('prefetch', document)"
        >
          <td class="p-2" @click.stop>
            <UCheckbox
              :model-value="isSelected(document.id)"
              @click="onSelect(document, $event, 'toggle')"
            />
          </td>
          <td class="p-2">
            <img
              :src="thumb(document)"
              :alt="document.title"
              loading="lazy"
              class="h-10 w-8 rounded border border-default object-cover object-top"
            >
          </td>
          <td class="p-2">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <UIcon :name="documentIcon(document)" class="size-4 shrink-0 text-muted" />
                <span class="line-clamp-1 font-medium">{{ document.title }}</span>
              </div>
              <!-- eslint-disable-next-line vue/no-v-html -- highlightToHtml escapes the excerpt -->
              <p v-if="document.snippet" class="line-clamp-2 text-xs text-muted" v-html="highlightToHtml(document.snippet)" />
            </div>
          </td>
          <td class="hidden p-2 text-muted lg:table-cell">
            {{ formatDate(document.created) }}
          </td>
          <td class="hidden p-2 text-muted xl:table-cell">
            {{ formatDate(document.added) }}
          </td>
          <td class="hidden p-2 text-muted 2xl:table-cell">
            {{ document.archiveSerialNumber ?? '—' }}
          </td>
          <td class="hidden p-2 xl:table-cell">
            <div class="flex flex-wrap gap-1">
              <UBadge
                v-for="tag in document.tags.slice(0, 3)"
                :key="tag"
                size="sm"
                variant="subtle"
                :style="tagColor(tag) ? { backgroundColor: tagColor(tag) } : undefined"
              >
                {{ tagName(tag) }}
              </UBadge>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
