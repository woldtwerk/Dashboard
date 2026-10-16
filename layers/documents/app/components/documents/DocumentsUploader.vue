<script setup lang="ts">
import type { DocumentsTask } from '#layers/documents/shared/types/documents'

const props = defineProps<{
  service: string
}>()

const emit = defineEmits<{ done: [] }>()

const input = ref<HTMLInputElement>()
const dragging = ref(false)
const title = ref('')

interface UploadJob {
  id: string
  name: string
  status: 'uploading' | DocumentsTask['status']
  error?: string
}

const jobs = ref<UploadJob[]>([])
const busy = computed(() => jobs.value.some(job => job.status === 'uploading' || job.status === 'pending' || job.status === 'started'))

function progressOf(status: UploadJob['status']): number {
  switch (status) {
    case 'uploading': return 25
    case 'pending': return 50
    case 'started': return 75
    default: return 100
  }
}

function colorOf(status: UploadJob['status']): 'success' | 'error' | 'neutral' {
  if (status === 'success') {
    return 'success'
  }
  return status === 'failure' || status === 'revoked' ? 'error' : 'neutral'
}

const TERMINAL: DocumentsTask['status'][] = ['success', 'failure', 'revoked']

async function pollTask(taskId: string, job: UploadJob) {
  for (let attempt = 0; attempt < 180; attempt++) {
    const task = await documentsRequest<DocumentsTask>(`/api/documents/tasks/${taskId}`, { query: { service: props.service } })
    job.status = task.status
    if (TERMINAL.includes(task.status)) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  job.status = 'failure'
  job.error = 'Timed out waiting for the archive'
}

async function send(files: File[]) {
  if (!props.service || !files.length) {
    return
  }

  for (const file of files) {
    const form = new FormData()
    form.append('document', file)
    if (title.value && files.length === 1) {
      form.append('title', title.value)
    }

    const job: UploadJob = { id: crypto.randomUUID(), name: file.name, status: 'uploading' }
    jobs.value = [...jobs.value, job]

    try {
      const { taskId } = await documentsRequest<{ taskId: string }>('/api/documents/upload', {
        method: 'POST',
        query: { service: props.service },
        body: form,
        raw: true
      })
      await pollTask(taskId, job)
    } catch (error) {
      job.status = 'failure'
      job.error = error instanceof Error ? error.message : 'Upload failed'
    }
  }

  title.value = ''
  emit('done')
}

function onPicked(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files ?? [])
  target.value = ''
  send(files)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  send(Array.from(event.dataTransfer?.files ?? []))
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="title"
        placeholder="Optional title (single file)"
        size="sm"
        class="max-w-72"
      />
      <UButton
        label="Upload"
        icon="i-lucide-upload"
        size="sm"
        :loading="busy"
        @click="input?.click()"
      />
      <input
        ref="input"
        type="file"
        multiple
        class="hidden"
        @change="onPicked"
      >
    </div>

    <div
      class="rounded-lg border border-dashed p-6 text-center text-sm text-muted transition"
      :class="dragging ? 'border-primary bg-primary/5' : 'border-default'"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <UIcon name="i-lucide-cloud-upload" class="mx-auto mb-2 size-6 text-dimmed" />
      Drop files here, or use Upload
    </div>

    <div v-if="jobs.length" class="space-y-2">
      <div v-for="job in jobs" :key="job.id" class="space-y-1">
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="flex min-w-0 items-center gap-2">
            <UIcon
              :name="job.status === 'success' ? 'i-lucide-check-circle' : job.status === 'failure' || job.status === 'revoked' ? 'i-lucide-circle-alert' : 'i-lucide-loader-circle'"
              class="size-4 shrink-0"
              :class="job.status === 'uploading' || job.status === 'pending' || job.status === 'started' ? 'animate-spin' : ''"
            />
            <span class="truncate">{{ job.name }}</span>
          </span>
          <span class="shrink-0 text-dimmed">{{ job.error || job.status }}</span>
        </div>
        <UProgress :model-value="progressOf(job.status)" :color="colorOf(job.status)" size="xs" />
      </div>
    </div>
  </div>
</template>
