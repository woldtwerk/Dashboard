<script setup lang="ts">
defineProps<{
  entries: Array<{
    key: string
    label: string
    defaultLabel: string
    icon: string
    available: boolean
  }>
}>()

const emit = defineEmits<{
  move: [from: number, to: number]
  rename: [key: string, label: string]
}>()

const dragging = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

function onDragStart(index: number, event: DragEvent) {
  dragging.value = index
  // Firefox only starts a drag once dataTransfer carries something
  event.dataTransfer?.setData('text/plain', String(index))
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function onDragOver(index: number, event: DragEvent) {
  const target = event.currentTarget as HTMLElement
  const after = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2
  dropIndex.value = after ? index + 1 : index
}

function onDrop() {
  if (dragging.value === null || dropIndex.value === null) {
    return
  }

  // Taking the dragged entry out first shifts every later target up by one
  const to = dropIndex.value > dragging.value ? dropIndex.value - 1 : dropIndex.value
  emit('move', dragging.value, to)
  onDragEnd()
}

function onDragEnd() {
  dragging.value = null
  dropIndex.value = null
}
</script>

<template>
  <ul class="flex flex-col gap-0.5">
    <template
      v-for="(entry, index) in entries"
      :key="entry.key"
    >
      <li
        v-if="dropIndex === index"
        class="h-0.5 rounded-full bg-primary"
        aria-hidden="true"
      />

      <li
        draggable="true"
        class="flex items-center gap-2 rounded-lg px-2 py-1.5"
        :class="[!entry.available && 'opacity-60', dragging === index && 'bg-elevated']"
        @dragstart="onDragStart(index, $event)"
        @dragover.prevent="onDragOver(index, $event)"
        @drop.prevent="onDrop"
        @dragend="onDragEnd"
      >
        <UIcon
          name="i-lucide-grip-vertical"
          class="size-4 shrink-0 cursor-grab text-dimmed"
        />
        <UIcon
          :name="entry.icon"
          class="size-4 shrink-0"
        />

        <div class="flex min-w-0 flex-1 flex-col">
          <UInput
            :model-value="entry.label"
            :placeholder="entry.defaultLabel"
            size="xs"
            variant="subtle"
            class="w-full"
            @update:model-value="value => emit('rename', entry.key, String(value ?? ''))"
          />
          <span
            v-if="entry.label !== entry.defaultLabel"
            class="mt-0.5 truncate text-xs text-muted"
          >
            {{ entry.defaultLabel }}
          </span>
          <span
            v-else-if="!entry.available"
            class="mt-0.5 truncate text-xs text-muted"
          >
            no service yet
          </span>
        </div>

        <div class="flex shrink-0 items-center">
          <UButton
            icon="i-lucide-chevron-up"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Move up"
            :disabled="index === 0"
            @click="emit('move', index, index - 1)"
          />
          <UButton
            icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Move down"
            :disabled="index === entries.length - 1"
            @click="emit('move', index, index + 1)"
          />
        </div>
      </li>
    </template>

    <li
      v-if="dropIndex === entries.length"
      class="h-0.5 rounded-full bg-primary"
      aria-hidden="true"
    />
  </ul>
</template>
