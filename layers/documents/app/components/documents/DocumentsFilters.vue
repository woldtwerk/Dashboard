<script setup lang="ts">
import type { DocumentsCorrespondent, DocumentsCustomField, DocumentsDocumentType, DocumentsFilters as Filters, DocumentsStoragePath, DocumentsTag } from '#layers/documents/shared/types/documents'
import { EMPTY_DOCUMENTS_FILTERS } from '#layers/documents/shared/types/documents'

const props = defineProps<{
  tags: DocumentsTag[]
  correspondents: DocumentsCorrespondent[]
  documentTypes: DocumentsDocumentType[]
  storagePaths: DocumentsStoragePath[]
  customFields: DocumentsCustomField[]
}>()

const model = defineModel<Filters>({ required: true })

function set<K extends keyof Filters>(key: K, value: Filters[K]) {
  model.value = { ...model.value, [key]: value }
}

const tagItems = computed(() => props.tags.map(tag => ({ label: tag.name, value: tag.id })))
const correspondentItems = computed(() => props.correspondents.map(item => ({ label: item.name, value: item.id })))
const typeItems = computed(() => props.documentTypes.map(item => ({ label: item.name, value: item.id })))
const pathItems = computed(() => props.storagePaths.map(item => ({ label: item.name, value: item.id })))
const fieldItems = computed(() => props.customFields.map(item => ({ label: item.name, value: item.id })))

const selectedField = computed({
  get: () => model.value.customField?.field,
  set: (field: number | undefined) => set('customField', field === undefined ? undefined : { field, value: model.value.customField?.value ?? '' })
})

const fieldValue = computed({
  get: () => model.value.customField?.value ?? '',
  set: (value: string) => {
    const field = model.value.customField?.field
    set('customField', field === undefined ? undefined : { field, value })
  }
})

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value)
  return value !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function updateRange(prefix: 'created' | 'added', bound: 'after' | 'before', value: string) {
  const range = { ...model.value[prefix] }
  if (value) {
    range[bound] = value
  } else if (bound === 'after') {
    delete range.after
  } else {
    delete range.before
  }
  set(prefix, range)
}

function reset() {
  model.value = { ...structuredClone(EMPTY_DOCUMENTS_FILTERS) }
}
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    <UFormField label="Tags">
      <USelectMenu
        :model-value="model.tags"
        :items="tagItems"
        value-key="value"
        multiple
        placeholder="Any of these…"
        class="w-full"
        @update:model-value="value => set('tags', value)"
      />
    </UFormField>

    <UFormField label="Excluded tags">
      <USelectMenu
        :model-value="model.tagsExcluded"
        :items="tagItems"
        value-key="value"
        multiple
        placeholder="None of these…"
        class="w-full"
        @update:model-value="value => set('tagsExcluded', value)"
      />
    </UFormField>

    <UFormField label="Tag mode" description="Included tags must all or any match">
      <USelect
        :model-value="model.tagsMode"
        :items="[{ label: 'Any', value: 'any' }, { label: 'All', value: 'all' }]"
        class="w-full"
        @update:model-value="value => set('tagsMode', value as 'any' | 'all')"
      />
    </UFormField>

    <UFormField label="Correspondent">
      <USelect
        :model-value="model.correspondent"
        :items="correspondentItems"
        placeholder="Any"
        clearable
        class="w-full"
        @update:model-value="value => set('correspondent', value as number | undefined)"
      />
    </UFormField>

    <UFormField label="Document type">
      <USelect
        :model-value="model.documentType"
        :items="typeItems"
        placeholder="Any"
        clearable
        class="w-full"
        @update:model-value="value => set('documentType', value as number | undefined)"
      />
    </UFormField>

    <UFormField label="Storage path">
      <USelect
        :model-value="model.storagePath"
        :items="pathItems"
        placeholder="Any"
        clearable
        class="w-full"
        @update:model-value="value => set('storagePath', value as number | undefined)"
      />
    </UFormField>

    <UFormField label="Custom field">
      <div class="flex gap-2">
        <USelect
          v-model="selectedField"
          :items="fieldItems"
          placeholder="Field"
          clearable
          class="flex-1"
        />
        <UInput
          :model-value="fieldValue"
          placeholder="Value"
          class="flex-1"
          @update:model-value="fieldValue = $event"
        />
      </div>
    </UFormField>

    <UFormField label="Created after">
      <UInput
        :model-value="model.created.after ?? ''"
        type="date"
        class="w-full"
        @update:model-value="value => updateRange('created', 'after', value)"
      />
    </UFormField>

    <UFormField label="Created before">
      <UInput
        :model-value="model.created.before ?? ''"
        type="date"
        class="w-full"
        @update:model-value="value => updateRange('created', 'before', value)"
      />
    </UFormField>

    <UFormField label="Added after">
      <UInput
        :model-value="model.added.after ?? ''"
        type="date"
        class="w-full"
        @update:model-value="value => updateRange('added', 'after', value)"
      />
    </UFormField>

    <UFormField label="Added before">
      <UInput
        :model-value="model.added.before ?? ''"
        type="date"
        class="w-full"
        @update:model-value="value => updateRange('added', 'before', value)"
      />
    </UFormField>

    <UFormField label="ASN">
      <UInput
        :model-value="model.asn !== undefined ? String(model.asn) : ''"
        type="number"
        min="0"
        class="w-full"
        @update:model-value="(value: string) => set('asn', numberOrUndefined(value))"
      />
    </UFormField>

    <UFormField label="Owner (user id)">
      <UInput
        :model-value="model.owner !== undefined ? String(model.owner) : ''"
        type="number"
        min="0"
        class="w-full"
        @update:model-value="(value: string) => set('owner', numberOrUndefined(value))"
      />
    </UFormField>

    <div class="flex items-end">
      <USwitch
        :model-value="model.inbox"
        label="Inbox"
        @update:model-value="value => set('inbox', value)"
      />
    </div>

    <div class="flex items-end justify-end">
      <UButton
        label="Clear filters"
        icon="i-lucide-filter-x"
        color="neutral"
        variant="ghost"
        size="sm"
        @click="reset"
      />
    </div>
  </div>
</template>
