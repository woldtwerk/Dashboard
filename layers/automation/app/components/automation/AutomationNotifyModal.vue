<script setup lang="ts">
import { useClipboard, useTimeoutFn } from '@vueuse/core'

/**
 * Shows the pop-up one automation notification produced. The overlay provider
 * opens it from `useOverlay`; `open` is the model it drives, and closing it
 * removes `automation-modal` from the URL (see the plugin). The text is fetched
 * from the run, so it never has to travel through a desktop push.
 */
const props = defineProps<{ runId?: string, nodeId?: string }>()
const open = defineModel<boolean>('open', { default: true })

interface NotificationModal {
  title?: string
  text: string
  copy: boolean
  at: string
}

const toast = useToast()
const { copy } = useClipboard()

const state = ref<'loading' | 'ready' | 'expired' | 'error'>('loading')
const data = ref<NotificationModal | null>(null)
const copied = ref(false)

const resetCopied = useTimeoutFn(() => {
  copied.value = false
}, 2000)

async function load(runId: string, nodeId: string) {
  state.value = 'loading'
  data.value = null
  copied.value = false
  try {
    data.value = await $fetch<NotificationModal>(`/api/automation/runs/${runId}/modal/${nodeId}`)
    state.value = 'ready'
  } catch (error) {
    const status = (error as { status?: number, response?: { status?: number } })?.status
      ?? (error as { response?: { status?: number } })?.response?.status
    state.value = status === 410 ? 'expired' : 'error'
  }
}

watch([() => props.runId, () => props.nodeId, open], ([runId, nodeId, isOpen]) => {
  if (isOpen && runId && nodeId) {
    void load(runId, nodeId)
  }
}, { immediate: true })

async function copyText() {
  if (!data.value?.text) {
    return
  }
  await copy(data.value.text)
  copied.value = true
  resetCopied.start()
  toast.add({ title: 'Copied', icon: 'i-lucide-clipboard-check' })
}
</script>

<template>
  <UModal v-model:open="open" :title="data?.title || 'Notification'">
    <template #body>
      <div v-if="state === 'loading'" class="flex justify-center py-8">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
      </div>

      <p v-else-if="state === 'expired'" class="py-6 text-center text-sm text-muted">
        This notification has expired.
      </p>

      <p v-else-if="state === 'error'" class="py-6 text-center text-sm text-muted">
        The notification could not be loaded.
      </p>

      <div v-else-if="data?.copy" class="flex items-center justify-center rounded-lg border border-default bg-elevated px-6 py-5">
        <pre class="whitespace-pre-wrap break-all text-center font-mono text-2xl font-semibold tracking-[0.12em] text-highlighted">{{ data.text }}</pre>
      </div>

      <p v-else class="whitespace-pre-wrap text-sm text-default">
        {{ data?.text }}
      </p>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Close"
          color="neutral"
          variant="ghost"
          @click="open = false"
        />
        <UButton
          v-if="data?.copy"
          :label="copied ? 'Copied' : 'Copy'"
          :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          :disabled="state !== 'ready'"
          @click="copyText"
        />
      </div>
    </template>
  </UModal>
</template>
