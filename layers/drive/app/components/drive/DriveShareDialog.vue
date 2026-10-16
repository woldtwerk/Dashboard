<script setup lang="ts">
import type { DriveEntry, DriveShare } from '#layers/drive/shared/types/drive'
import { driveRequest } from '../../utils/drive-request'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  entry: DriveEntry | null
  service: string
}>()

const emit = defineEmits<{
  changed: []
}>()

const toast = useToast()
const { copy, copied } = useClipboard()

const share = ref<DriveShare>()
const loading = ref(false)
const saving = ref(false)
const error = ref<string>()
const form = reactive({ role: 'viewer', password: '', expiration: '' })

const roles = [
  { label: 'Viewer', value: 'viewer' },
  { label: 'Editor', value: 'editor' }
]

watch(open, async (value) => {
  if (!value || !props.entry) {
    return
  }
  loading.value = true
  error.value = undefined
  share.value = undefined
  try {
    const result = await driveRequest<DriveShare>('/api/drive/share', { query: { service: props.service, path: props.entry.path } })
    share.value = result
    form.role = result.role ?? 'viewer'
  } catch (failure) {
    error.value = messageOf(failure)
  } finally {
    loading.value = false
  }
})

async function save() {
  if (!props.entry) {
    return
  }
  saving.value = true
  error.value = undefined
  try {
    share.value = await driveRequest<DriveShare>('/api/drive/share', {
      method: 'PUT',
      body: {
        service: props.service,
        path: props.entry.path,
        role: form.role || undefined,
        password: form.password || undefined,
        expiration: form.expiration || undefined
      }
    })
    emit('changed')
  } catch (failure) {
    error.value = messageOf(failure)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!props.entry) {
    return
  }
  saving.value = true
  error.value = undefined
  try {
    await driveRequest('/api/drive/share', { method: 'DELETE', query: { service: props.service, path: props.entry.path } })
    share.value = { shared: false }
    emit('changed')
    toast.add({ title: 'Share link removed', color: 'success', icon: 'i-lucide-check-circle' })
  } catch (failure) {
    error.value = messageOf(failure)
  } finally {
    saving.value = false
  }
}

function copyLink() {
  if (share.value?.url) {
    copy(share.value.url)
  }
}

function messageOf(failure: unknown): string {
  const { data } = failure as { data?: { statusMessage?: string, message?: string } }
  return data?.statusMessage || data?.message || 'Something went wrong'
}
</script>

<template>
  <UModal v-model:open="open" title="Share link">
    <template #body>
      <div v-if="entry" class="space-y-4">
        <p class="truncate text-sm text-muted">
          {{ entry.name }}
        </p>

        <div v-if="loading" class="flex justify-center py-6">
          <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-dimmed" />
        </div>

        <template v-else>
          <div v-if="share?.shared" class="space-y-3">
            <UFormField label="Link">
              <div class="flex items-center gap-2">
                <UInput :model-value="share.url" readonly class="w-full" />
                <UButton
                  :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                  color="neutral"
                  variant="outline"
                  aria-label="Copy link"
                  @click="copyLink"
                />
              </div>
            </UFormField>
            <p v-if="share.passwordProtected" class="text-xs text-dimmed">
              This link is protected by a password.
            </p>
          </div>

          <p v-else class="text-sm text-muted">
            No link yet. Create one to share this {{ entry.type === 'folder' ? 'folder' : 'file' }}.
          </p>

          <UFormField label="Access">
            <USelect v-model="form.role" :items="roles" class="w-full" />
          </UFormField>

          <UFormField label="Password" description="Optional; leave empty to remove a password.">
            <UInput
              v-model="form.password"
              type="password"
              autocomplete="off"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Expires" description="Optional date when the link stops working.">
            <UInput v-model="form.expiration" type="date" class="w-full" />
          </UFormField>

          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="error"
          />
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-2">
        <UButton
          v-if="share?.shared"
          label="Remove link"
          icon="i-lucide-link-2-off"
          color="error"
          variant="ghost"
          :loading="saving"
          @click="remove"
        />
        <span v-else />

        <div class="flex gap-2">
          <UButton
            label="Close"
            color="neutral"
            variant="ghost"
            @click="open = false"
          />
          <UButton
            :label="share?.shared ? 'Update link' : 'Create link'"
            icon="i-lucide-link"
            :loading="saving"
            :disabled="loading"
            @click="save"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
