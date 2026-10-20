<script setup lang="ts">
import type { FileSourceMeta } from '#layers/core/shared/types/file-sources'
import type { DriveSaveChoice } from '#layers/drive/app/utils/drive-save-attachments'

const open = defineModel<boolean>('open', { default: true })

const props = withDefaults(defineProps<{
  attachments: FileSourceMeta[]
  /** The drive services the user may save into */
  services: Array<{ id: string, name: string }>
  initialService?: string
  initialFolder?: string
  title?: string
}>(), {
  initialFolder: '/my-files',
  title: 'Save attachments to drive'
})

const emit = defineEmits<{
  close: [choice?: DriveSaveChoice]
}>()

const service = ref(props.initialService ?? props.services[0]?.id ?? '')
const folder = ref(props.initialFolder || '/my-files')
const checkDuplicates = ref(true)
const pickerOpen = ref(false)

const serviceItems = computed(() => props.services.map(item => ({ label: item.name, value: item.id })))
const canSave = computed(() => !!service.value && !!folder.value.trim())

function cancel() {
  open.value = false
}

function save() {
  if (!canSave.value) {
    return
  }
  emit('close', {
    service: service.value,
    folder: folder.value.trim(),
    checkDuplicates: checkDuplicates.value
  })
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="attachments.length === 1 ? attachments[0]!.filename : `${attachments.length} files`"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="!services.length"
          color="warning"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="No drive service"
          description="Add a drive service before saving attachments."
        />

        <UFormField v-else label="Drive">
          <USelect
            v-model="service"
            :items="serviceItems"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Folder">
          <div class="flex gap-2">
            <UInput
              v-model="folder"
              placeholder="/my-files/…"
              class="min-w-0 flex-1"
            />
            <UButton
              icon="i-lucide-folder-open"
              color="neutral"
              variant="outline"
              aria-label="Choose a folder"
              :disabled="!service"
              @click="pickerOpen = true"
            />
          </div>
        </UFormField>

        <UCheckbox
          v-model="checkDuplicates"
          label="Check for duplicates"
          description="Skip files whose bytes are already in the folder."
        />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="cancel"
        />
        <UButton
          label="Save"
          icon="i-lucide-hard-drive"
          :disabled="!canSave"
          @click="save"
        />
      </div>
    </template>
  </UModal>

  <DriveFolderPicker
    v-if="service"
    v-model:open="pickerOpen"
    :service="service"
    :initial-path="folder || '/my-files'"
    title="Choose a folder"
    confirm-label="Use this folder"
    @select="folder = $event"
  />
</template>
