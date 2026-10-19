<script setup lang="ts">
import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import type { UIMessage } from 'ai'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { parseModelParam, resolveModelSelection, serializeModelParam } from '#layers/ai/shared/ai-model'
import type { AiModelSelection, AiServiceModels } from '#layers/ai/shared/types/ai'
import type { AssistantChat, AssistantDomainInfo, AssistantSettings } from '#layers/mail-ai/shared/types/assistant'
import { assistantTitleFromText, toAssistantUIMessages } from '#layers/mail-ai/shared/assistant-chat'
import { assistantChatKey } from '#layers/mail-ai/app/utils/assistant-chats'

const props = defineProps<{
  chatId: string
  /** A route that already has an id; a new chat keeps its client id until the first answer */
  existing: boolean
  titleOverride?: string
}>()

const emit = defineEmits<{
  'finished': []
  'new-chat': []
  'open-list': []
}>()

const aiAvailable = useAiAvailable()
const route = useRoute()
const router = useRouter()
const isMobile = useBreakpoints(breakpointsTailwind).smaller('lg')

// Captured once: the URL gains an id after the first message, but this chat is
// already live and must not be fetched or remounted.
const isStoredChat = props.existing

const { data: chat, error: chatError } = await useFetch<AssistantChat>(() => `/api/assistant/chats/${props.chatId}`, {
  key: () => assistantChatKey(props.chatId),
  immediate: isStoredChat,
  server: isStoredChat,
  default: () => undefined
})

const localTitle = ref(chat.value?.title ?? '')
const displayTitle = computed(() => props.titleOverride || localTitle.value || 'New chat')
const loadFailed = computed(() => isStoredChat && !chat.value && !!chatError.value)

// The model list loads after the page, so the chat is usable while the provider answers
const { data: aiServices, status: modelsStatus } = useLazyFetch<AiServiceModels[]>('/api/ai/models', { default: () => [] })

// The selected model lives in the URL as `?model=<serviceId>:<modelId>`
const requestedModel = computed(() => parseModelParam(route.query.model))
const selection = computed(() => resolveModelSelection(aiServices.value, requestedModel.value))
const selectedModel = computed(() => serializeModelParam(selection.value) ?? '')

function isDefault(candidate?: AiModelSelection): boolean {
  const first = aiServices.value[0]
  return !!candidate && !!first && candidate.serviceId === first.service.id && candidate.modelId === first.defaultModel
}

function setModel(value?: string) {
  const parsed = parseModelParam(value)
  const current = typeof route.query.model === 'string' ? route.query.model : undefined
  const next = parsed && !isDefault(parsed) ? serializeModelParam(parsed) : undefined
  if (next !== current) {
    router.replace({ query: { ...route.query, model: next } })
  }
}

// Drop a model the service does not offer from the URL; the select falls back to the default
watch(aiServices, (services) => {
  const raw = route.query.model
  if (!services.length || typeof raw !== 'string' || !raw) {
    return
  }
  if (serializeModelParam(resolveModelSelection(services, parseModelParam(raw))) !== raw) {
    setModel(undefined)
  }
}, { immediate: true })

const input = ref('')

const { messages, status, error, sendMessage, stop, regenerate } = useChat({
  id: props.chatId,
  messages: toAssistantUIMessages(chat.value?.messages ?? []),
  transport: new DefaultChatTransport<UIMessage>({
    api: '/api/mail/ai/chat',
    // The server owns the history; only the new message travels from here
    prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => ({
      body: {
        id,
        message: messages[messages.length - 1],
        service: selection.value?.serviceId,
        model: selection.value?.modelId,
        trigger,
        messageId
      }
    })
  }),
  onFinish: () => emit('finished')
})

const suggestions = [
  'Which invoices did I get this month?',
  'Summarize my unread mails',
  'Was gibt es Neues zum Projekt?'
]

// The empty state names what the assistant may read; every enabled area sends
// its data to the AI provider, so the user sees the choice before asking.
const { data: assistantSettings } = useSettings<AssistantSettings>('assistant')
const { data: assistantDomains } = useLazyFetch<AssistantDomainInfo[]>('/api/mail/ai/domains', {
  key: 'assistant-domains',
  default: () => []
})
const enabledDomainLabels = computed(() => {
  const enabled = new Set(assistantSettings.value.domains ?? [])
  return assistantDomains.value.filter(domain => enabled.has(domain.domain)).map(domain => domain.label)
})

const busy = computed(() => status.value === 'streaming' || status.value === 'submitted')

function submit(text = input.value) {
  if (!text.trim() || busy.value) {
    return
  }

  if (!localTitle.value) {
    localTitle.value = assistantTitleFromText(text)
  }

  // The pending id becomes the route id; the chat component keeps its key and
  // therefore its streaming state.
  if (!isStoredChat && route.path === '/assistant') {
    void router.replace({ path: `/assistant/${props.chatId}`, query: { ...route.query } })
  }

  void sendMessage({ text })
  input.value = ''
}
</script>

<template>
  <UDashboardPanel id="assistant" :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <UDashboardNavbar :title="displayTitle">
        <template #leading>
          <UButton
            v-if="isMobile"
            icon="i-lucide-panel-left"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Chats"
            @click="emit('open-list')"
          />
          <UDashboardSidebarCollapse v-else />
        </template>

        <template #right>
          <UButton
            icon="i-lucide-plus"
            label="New chat"
            size="xs"
            @click="emit('new-chat')"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UContainer class="flex flex-1 flex-col gap-4 py-4 sm:gap-6 sm:py-6">
        <UEmpty
          v-if="!aiAvailable"
          icon="i-lucide-sparkles"
          title="No AI service yet"
          description="Add an AI provider to ask questions about your data."
          :actions="[{ label: 'Add service', icon: 'i-lucide-plus', to: '/services/new' }]"
          class="flex-1"
        />

        <div v-else-if="loadFailed" class="flex flex-1 flex-col items-center justify-center gap-4">
          <UError :error="{ statusCode: chatError?.statusCode ?? 404, statusMessage: chatError?.statusMessage ?? 'Chat not found' }" />
          <UButton label="Start a new chat" icon="i-lucide-plus" @click="emit('new-chat')" />
        </div>

        <template v-else>
          <div v-if="!messages.length" class="flex flex-1 flex-col items-center justify-center gap-4">
            <UIcon name="i-lucide-sparkles" class="size-10 text-primary" />
            <p class="max-w-md text-center text-muted">
              <template v-if="enabledDomainLabels.length">
                Ask about your data. The assistant can read {{ enabledDomainLabels.join(', ') }}.
              </template>
              <template v-else>
                No area is enabled for the assistant yet. Enable one to let it answer.
              </template>
            </p>
            <UButton
              label="Settings · Assistant"
              icon="i-lucide-settings"
              color="neutral"
              variant="outline"
              size="sm"
              to="/settings?section=assistant"
            />
            <div class="flex flex-wrap justify-center gap-2">
              <UButton
                v-for="suggestion in suggestions"
                :key="suggestion"
                :label="suggestion"
                color="neutral"
                variant="outline"
                size="sm"
                @click="submit(suggestion)"
              />
            </div>
          </div>

          <UChatMessages
            v-else
            should-auto-scroll
            :messages="messages"
            :status="status"
            class="flex-1"
          >
            <template #content="{ message }">
              <AssistantMessageParts :message="message" />
            </template>
          </UChatMessages>

          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="The assistant could not answer"
            :description="error.message"
            :actions="[{ label: 'Retry', color: 'error', variant: 'outline', onClick: () => regenerate() }]"
          />

          <UChatPrompt
            v-model="input"
            :error="error"
            placeholder="Ask about your data…"
            class="sticky bottom-0"
            @submit="submit()"
          >
            <template #footer>
              <AiModelSelect
                :model-value="selectedModel"
                :services="aiServices"
                :loading="modelsStatus === 'pending'"
                :disabled="busy"
                @update:model-value="setModel"
              />
              <UChatPromptSubmit
                :status="status"
                @stop="stop()"
                @reload="regenerate()"
              />
            </template>
          </UChatPrompt>

          <p class="text-center text-xs text-dimmed">
            Questions and mail excerpts are sent to your AI provider.
          </p>
        </template>
      </UContainer>
    </template>
  </UDashboardPanel>
</template>
