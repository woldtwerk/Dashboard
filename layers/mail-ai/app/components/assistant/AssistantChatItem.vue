<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { AssistantChatSummary } from '#layers/mail-ai/shared/types/assistant'
import { assistantChatKey } from '#layers/mail-ai/app/utils/assistant-chats'

const props = defineProps<{
  chat: AssistantChatSummary
  active: boolean
  /** The current list search, so opening a chat keeps the filter */
  search?: string
}>()

const emit = defineEmits<{
  rename: [id: string, title: string]
  delete: [chat: AssistantChatSummary]
}>()

const renaming = ref(false)
const draft = ref('')

// Same key as the chat page, so hovering warms the request it will reuse
const { execute: prefetch } = useLazyFetch(`/api/assistant/chats/${props.chat.id}`, {
  key: assistantChatKey(props.chat.id),
  immediate: false,
  server: false
})

function warm() {
  void prefetch()
}

function startRename() {
  draft.value = props.chat.title
  renaming.value = true
}

function cancelRename() {
  draft.value = props.chat.title
  renaming.value = false
}

function saveRename() {
  if (!renaming.value) {
    return
  }

  const title = draft.value.trim()
  renaming.value = false

  if (title && title !== props.chat.title) {
    emit('rename', props.chat.id, title)
  }
}

const items = computed<DropdownMenuItem[][]>(() => [[
  {
    label: 'Rename',
    icon: 'i-lucide-pencil',
    onSelect: startRename
  }
], [
  {
    label: 'Delete',
    icon: 'i-lucide-trash',
    color: 'error' as const,
    onSelect: () => emit('delete', props.chat)
  }
]])
</script>

<template>
  <div
    class="group flex items-center gap-1 rounded-md pr-1"
    :class="active ? 'bg-elevated text-highlighted' : 'text-muted hover:bg-elevated/50 hover:text-default'"
  >
    <UInput
      v-if="renaming"
      v-model="draft"
      size="sm"
      autofocus
      class="m-1 min-w-0 flex-1"
      :ui="{ base: 'w-full' }"
      @keydown.enter.prevent="saveRename"
      @keydown.esc.prevent="cancelRename"
      @blur="saveRename"
    />
    <NuxtLink
      v-else
      :to="{ path: `/assistant/${chat.id}`, query: search ? { q: search } : {} }"
      class="min-w-0 flex-1 truncate px-2 py-1.5 text-sm"
      :title="chat.title"
      @mouseenter="warm"
      @focus="warm"
    >
      {{ chat.title || 'Untitled' }}
    </NuxtLink>

    <UDropdownMenu v-if="!renaming" :items="items" :content="{ align: 'end' }">
      <UButton
        icon="i-lucide-ellipsis"
        color="neutral"
        variant="ghost"
        size="xs"
        class="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
        :aria-label="`Actions for ${chat.title}`"
        @click.stop.prevent
      />
    </UDropdownMenu>
  </div>
</template>
