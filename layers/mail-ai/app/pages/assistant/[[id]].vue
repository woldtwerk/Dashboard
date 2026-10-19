<script setup lang="ts">
import { breakpointsTailwind, refDebounced, useBreakpoints } from '@vueuse/core'
import type { AssistantChatSummary } from '#layers/mail-ai/shared/types/assistant'
import { ASSISTANT_CHATS_KEY } from '#layers/mail-ai/app/utils/assistant-chats'

useSeoMeta({ title: 'Assistant' })

// The chat lives below this page, so both `/assistant` and `/assistant/<id>`
// keep the same page instance. A first message may change the URL without
// losing the streaming chat.
definePageMeta({
  key: () => '/assistant'
})

const route = useRoute()
const router = useRouter()
const toast = useToast()
const isMobile = useBreakpoints(breakpointsTailwind).smaller('lg')

const routeId = computed(() => typeof route.params.id === 'string' ? route.params.id : undefined)

// A new chat gets its id before the first message and keeps it when the URL
// gains that id. Coming back to `/assistant` starts a fresh one.
const pendingId = useState<string>('assistant-new-chat-id', () => crypto.randomUUID())
watch(routeId, (id, previous) => {
  if (!id && previous) {
    pendingId.value = crypto.randomUUID()
  }
})

const chatKey = computed(() => routeId.value ?? pendingId.value)

const isChatListOpen = ref(false)
watch(routeId, () => {
  isChatListOpen.value = false
})

function startNewChat() {
  isChatListOpen.value = false

  if (routeId.value) {
    // A fresh id before the URL drops the old one, so a stale pending id can
    // never point at the chat we just left.
    pendingId.value = crypto.randomUUID()
    void router.push({ path: '/assistant', query: route.query.model ? { model: route.query.model } : {} })
    return
  }

  pendingId.value = crypto.randomUUID()
}

// The search term is the URL's `?q=`, so a filtered list can be shared.
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
watch(() => route.query.q, (value) => {
  const next = typeof value === 'string' ? value : ''
  if (next !== search.value) {
    search.value = next
  }
})
watch(search, (value) => {
  const q = value.trim() || undefined
  const current = typeof route.query.q === 'string' ? route.query.q : undefined
  if (q !== current) {
    void router.replace({ query: { ...route.query, q } })
  }
})

const debouncedSearch = refDebounced(search, 300)
const chatQuery = computed(() => {
  const q = debouncedSearch.value.trim()
  return q ? { q } : {}
})

const { data: chats, refresh: refreshChats } = await useFetch<AssistantChatSummary[]>('/api/assistant/chats', {
  key: ASSISTANT_CHATS_KEY,
  query: chatQuery,
  default: () => []
})

// A rename is visible in the header right away, even when the search filters
// the chat out of the list.
const titleOverrides = ref<Record<string, string>>({})
const activeTitle = computed(() => {
  const id = routeId.value
  if (!id) {
    return undefined
  }
  return titleOverrides.value[id] ?? chats.value.find(chat => chat.id === id)?.title
})

function withoutOverride(overrides: Record<string, string>, id: string): Record<string, string> {
  return Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== id))
}

async function renameChat(id: string, title: string) {
  const previous = chats.value
  chats.value = chats.value.map(chat => chat.id === id ? { ...chat, title } : chat)
  titleOverrides.value = { ...titleOverrides.value, [id]: title }

  try {
    await $fetch(`/api/assistant/chats/${id}`, {
      method: 'PATCH',
      body: { title }
    })
    toast.add({ title: 'Chat renamed', description: title, icon: 'i-lucide-pencil', duration: 2000 })
  } catch {
    chats.value = previous
    titleOverrides.value = withoutOverride(titleOverrides.value, id)
    toast.add({ title: 'Could not rename the chat', icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

async function deleteChat(id: string) {
  const previous = chats.value
  chats.value = chats.value.filter(chat => chat.id !== id)

  try {
    await $fetch(`/api/assistant/chats/${id}`, { method: 'DELETE' })

    titleOverrides.value = withoutOverride(titleOverrides.value, id)
    toast.add({ title: 'Chat deleted', icon: 'i-lucide-trash', duration: 2000 })

    if (routeId.value === id) {
      await navigateTo({ path: '/assistant', query: route.query.model ? { model: route.query.model } : {} })
    }
  } catch {
    chats.value = previous
    toast.add({ title: 'Could not delete the chat', icon: 'i-lucide-alert-circle', color: 'error' })
  }
}

function onFinished() {
  void refreshChats()
}
</script>

<template>
  <UDashboardPanel
    v-if="!isMobile"
    id="assistant-chats"
    :default-size="22"
    :min-size="16"
    :max-size="40"
    resizable
  >
    <template #header>
      <UDashboardNavbar title="Chats">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <UButton
            icon="i-lucide-plus"
            label="New chat"
            size="xs"
            @click="startNewChat"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <AssistantChatList
        :chats="chats"
        :active-id="routeId"
        :search="search"
        @update:search="search = $event"
        @rename="renameChat"
        @delete="deleteChat"
      />
    </template>
  </UDashboardPanel>

  <AssistantChatPanel
    :key="chatKey"
    :chat-id="chatKey"
    :existing="!!routeId"
    :title-override="activeTitle"
    @finished="onFinished"
    @new-chat="startNewChat"
    @open-list="isChatListOpen = true"
  />

  <ClientOnly>
    <USlideover
      v-if="isMobile"
      v-model:open="isChatListOpen"
      title="Chats"
      side="left"
    >
      <template #body>
        <div class="flex h-full min-h-0 flex-col gap-3">
          <UButton
            icon="i-lucide-plus"
            label="New chat"
            block
            @click="startNewChat"
          />
          <AssistantChatList
            :chats="chats"
            :active-id="routeId"
            :search="search"
            class="min-h-0 flex-1"
            @update:search="search = $event"
            @rename="renameChat"
            @delete="deleteChat"
          />
        </div>
      </template>
    </USlideover>
  </ClientOnly>
</template>
