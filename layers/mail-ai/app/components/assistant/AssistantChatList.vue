<script setup lang="ts">
import type { AssistantChatSummary } from '#layers/mail-ai/shared/types/assistant'
import { groupAssistantChats } from '#layers/mail-ai/app/utils/assistant-chats'

const props = defineProps<{
  chats: AssistantChatSummary[]
  activeId?: string
  search?: string
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  'rename': [id: string, title: string]
  'delete': [id: string]
}>()

// The groups count days in the shared zone against the same clock on both sides
const zone = useTimeZone()
const now = useDashboardNow()

const searchModel = computed({
  get: () => props.search ?? '',
  set: (value: string) => emit('update:search', value)
})

const groups = computed(() => groupAssistantChats(props.chats, zone.value, now.value))

const deleting = ref<AssistantChatSummary | null>(null)
const deleteOpen = computed({
  get: () => !!deleting.value,
  set: (open: boolean) => {
    if (!open) {
      deleting.value = null
    }
  }
})

function askDelete(chat: AssistantChatSummary) {
  deleting.value = chat
}

function confirmDelete() {
  if (deleting.value) {
    emit('delete', deleting.value.id)
  }
  deleting.value = null
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="shrink-0 p-3">
      <UInput
        v-model="searchModel"
        icon="i-lucide-search"
        placeholder="Search chats..."
        size="sm"
        class="w-full"
      >
        <template v-if="searchModel" #trailing>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="link"
            size="xs"
            aria-label="Clear search"
            @click="searchModel = ''"
          />
        </template>
      </UInput>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <div v-if="!chats.length" class="px-2 py-8 text-center text-sm text-muted">
        {{ search ? 'No chats match this search.' : 'No chats yet. Ask the assistant to start one.' }}
      </div>

      <div v-for="group in groups" :key="group.id" class="mb-4 last:mb-0">
        <p class="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-dimmed">
          {{ group.label }}
        </p>

        <AssistantChatItem
          v-for="chat in group.items"
          :key="chat.id"
          :chat="chat"
          :active="chat.id === activeId"
          :search="search"
          @rename="(id, title) => emit('rename', id, title)"
          @delete="askDelete"
        />
      </div>
    </div>
  </div>

  <UModal v-model:open="deleteOpen" title="Delete chat" description="The chat and its messages will be removed. This cannot be undone.">
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="deleteOpen = false"
        />
        <UButton label="Delete" color="error" @click="confirmDelete" />
      </div>
    </template>
  </UModal>
</template>
