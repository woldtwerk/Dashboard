<script setup lang="ts">
import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { parseModelParam, resolveModelSelection, serializeModelParam } from '#layers/ai/shared/ai-model'
import type { AiModelSelection, AiServiceModels } from '#layers/ai/shared/types/ai'

useSeoMeta({ title: 'Assistant' })

const aiAvailable = useAiAvailable()

const route = useRoute()
const router = useRouter()

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
  // Read at send time, so a new selection applies to the next message
  transport: new DefaultChatTransport({
    api: '/api/mail/ai/chat',
    body: () => ({ service: selection.value?.serviceId, model: selection.value?.modelId })
  })
})

const suggestions = [
  'Which invoices did I get this month?',
  'Summarize my unread mails',
  'Was gibt es Neues zum Projekt?'
]

function submit(text = input.value) {
  if (!text.trim() || status.value === 'streaming' || status.value === 'submitted') {
    return
  }
  sendMessage({ text })
  input.value = ''
}
</script>

<template>
  <UDashboardPanel id="assistant" :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <UDashboardNavbar title="Assistant">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UContainer class="flex flex-1 flex-col gap-4 py-4 sm:gap-6 sm:py-6">
        <UEmpty
          v-if="!aiAvailable"
          icon="i-lucide-sparkles"
          title="No AI service yet"
          description="Add an AI provider to ask questions about your mail."
          :actions="[{ label: 'Add service', icon: 'i-lucide-plus', to: '/services/new' }]"
          class="flex-1"
        />

        <template v-else>
          <div v-if="!messages.length" class="flex flex-1 flex-col items-center justify-center gap-4">
            <UIcon name="i-lucide-sparkles" class="size-10 text-primary" />
            <p class="text-center text-muted">
              Ask about your mail. The assistant searches your accounts and links the mails it used.
            </p>
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
            placeholder="Ask about your mail…"
            class="sticky bottom-0"
            @submit="submit()"
          >
            <template #footer>
              <AiModelSelect
                :model-value="selectedModel"
                :services="aiServices"
                :loading="modelsStatus === 'pending'"
                :disabled="status === 'streaming' || status === 'submitted'"
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
