<script setup lang="ts">
import type { DocumentsCorrespondent, DocumentsCustomField, DocumentsDocument, DocumentsDocumentPatch, DocumentsDocumentType, DocumentsStoragePath, DocumentsTag } from '#layers/documents/shared/types/documents'

const props = defineProps<{
  document: DocumentsDocument
  tags: DocumentsTag[]
  correspondents: DocumentsCorrespondent[]
  documentTypes: DocumentsDocumentType[]
  storagePaths: DocumentsStoragePath[]
  customFields: DocumentsCustomField[]
  saving?: boolean
}>()

const emit = defineEmits<{ save: [patch: DocumentsDocumentPatch] }>()

const title = ref(props.document.title)
const created = ref(props.document.created)
const correspondent = ref<number | undefined>(props.document.correspondent ?? undefined)
const documentType = ref<number | undefined>(props.document.documentType ?? undefined)
const storagePath = ref<number | undefined>(props.document.storagePath ?? undefined)
const selectedTags = ref<number[]>([...props.document.tags])
const asn = ref<number | undefined>(props.document.archiveSerialNumber ?? undefined)
const values = reactive<Record<number, string>>({})

function reset() {
  title.value = props.document.title
  created.value = props.document.created
  correspondent.value = props.document.correspondent ?? undefined
  documentType.value = props.document.documentType ?? undefined
  storagePath.value = props.document.storagePath ?? undefined
  selectedTags.value = [...props.document.tags]
  asn.value = props.document.archiveSerialNumber ?? undefined
  for (const field of props.customFields) {
    const current = props.document.customFields.find(item => item.field === field.id)?.value
    values[field.id] = current === null || current === undefined ? '' : String(current)
  }
}

watch(() => props.document, reset, { immediate: true })

const tagItems = computed(() => props.tags.map(tag => ({ label: tag.name, value: tag.id })))
const correspondentItems = computed(() => props.correspondents.map(item => ({ label: item.name, value: item.id })))
const typeItems = computed(() => props.documentTypes.map(item => ({ label: item.name, value: item.id })))
const pathItems = computed(() => props.storagePaths.map(item => ({ label: item.name, value: item.id })))

const dirty = computed(() => title.value !== props.document.title
  || created.value !== props.document.created
  || (correspondent.value ?? null) !== props.document.correspondent
  || (documentType.value ?? null) !== props.document.documentType
  || (storagePath.value ?? null) !== props.document.storagePath
  || selectedTags.value.slice().sort().join(',') !== props.document.tags.slice().sort().join(',')
  || (asn.value ?? null) !== props.document.archiveSerialNumber
  || props.customFields.some((field) => {
    const current = props.document.customFields.find(item => item.field === field.id)?.value
    return (values[field.id] ?? '') !== (current === null || current === undefined ? '' : String(current))
  }))

function customFieldValue(field: DocumentsCustomField, raw: string): string | number | boolean {
  if (field.dataType === 'boolean') {
    return raw === 'true'
  }
  if (field.dataType === 'integer') {
    return Number.parseInt(raw, 10) || 0
  }
  if (field.dataType === 'float' || field.dataType === 'monetary') {
    return Number.parseFloat(raw) || 0
  }
  return raw
}

function save() {
  const patch: DocumentsDocumentPatch = {}
  if (title.value.trim() !== props.document.title) {
    patch.title = title.value.trim()
  }
  if (created.value !== props.document.created) {
    patch.created = created.value
  }
  if ((correspondent.value ?? null) !== props.document.correspondent) {
    patch.correspondent = correspondent.value ?? null
  }
  if ((documentType.value ?? null) !== props.document.documentType) {
    patch.documentType = documentType.value ?? null
  }
  if ((storagePath.value ?? null) !== props.document.storagePath) {
    patch.storagePath = storagePath.value ?? null
  }
  if (selectedTags.value.slice().sort().join(',') !== props.document.tags.slice().sort().join(',')) {
    patch.tags = [...selectedTags.value]
  }
  if ((asn.value ?? null) !== props.document.archiveSerialNumber) {
    patch.archiveSerialNumber = asn.value ?? null
  }
  patch.customFields = props.customFields.map(field => ({
    field: field.id,
    value: values[field.id] ? customFieldValue(field, values[field.id]!) : null
  }))

  emit('save', patch)
}
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2">
    <UFormField label="Title" class="sm:col-span-2">
      <UInput v-model="title" class="w-full" />
    </UFormField>

    <UFormField label="Created">
      <UInput v-model="created" type="date" class="w-full" />
    </UFormField>

    <UFormField label="ASN">
      <UInput
        :model-value="asn !== undefined ? String(asn) : ''"
        type="number"
        min="0"
        class="w-full"
        @update:model-value="(value: string) => asn = value === '' ? undefined : Number(value)"
      />
    </UFormField>

    <UFormField label="Correspondent">
      <USelect
        v-model="correspondent"
        :items="correspondentItems"
        placeholder="None"
        clearable
        class="w-full"
      />
    </UFormField>

    <UFormField label="Document type">
      <USelect
        v-model="documentType"
        :items="typeItems"
        placeholder="None"
        clearable
        class="w-full"
      />
    </UFormField>

    <UFormField label="Storage path">
      <USelect
        v-model="storagePath"
        :items="pathItems"
        placeholder="None"
        clearable
        class="w-full"
      />
    </UFormField>

    <UFormField label="Tags">
      <USelectMenu
        v-model="selectedTags"
        :items="tagItems"
        value-key="value"
        multiple
        class="w-full"
      />
    </UFormField>

    <UFormField
      v-for="field in customFields"
      :key="field.id"
      :label="field.name"
    >
      <USwitch v-if="field.dataType === 'boolean'" :model-value="values[field.id] === 'true'" @update:model-value="values[field.id] = $event ? 'true' : 'false'" />
      <UInput
        v-else
        v-model="values[field.id]"
        :type="field.dataType === 'integer' || field.dataType === 'float' || field.dataType === 'monetary' ? 'number' : field.dataType === 'date' ? 'date' : 'text'"
        class="w-full"
      />
    </UFormField>

    <div class="flex items-end justify-end gap-2 sm:col-span-2">
      <UButton
        label="Reset"
        color="neutral"
        variant="ghost"
        :disabled="!dirty"
        @click="reset"
      />
      <UButton
        label="Save changes"
        icon="i-lucide-save"
        :disabled="!dirty"
        :loading="saving"
        @click="save"
      />
    </div>
  </div>
</template>
