<script setup lang="ts">
import type { UIMessage } from 'ai'
import { format } from 'date-fns'
import type { AssistantMailSource } from '#layers/mail-ai/shared/types/assistant'

defineProps<{
  message: UIMessage
}>()

interface ToolPart {
  type: string
  state: string
  output?: { results?: AssistantMailSource[], subject?: string, link?: string, error?: string }
  errorText?: string
}

const asTool = (part: unknown) => part as ToolPart
</script>

<template>
  <div class="flex flex-col gap-2">
    <template v-for="(part, index) in message.parts" :key="index">
      <!-- Plain text on purpose: model output may echo mail content and must not render as HTML -->
      <p v-if="part.type === 'text'" class="whitespace-pre-wrap">
        {{ part.text }}
      </p>

      <template v-else-if="part.type === 'tool-mail_search'">
        <UChatTool
          v-if="asTool(part).state !== 'output-available'"
          :text="asTool(part).state === 'output-error' ? 'Search failed' : 'Searching mail…'"
          icon="i-lucide-search"
          :loading="asTool(part).state !== 'output-error'"
        />
        <div v-else-if="asTool(part).output?.results?.length" class="flex flex-col gap-1">
          <span class="text-xs text-dimmed">Found {{ asTool(part).output!.results!.length }} mails</span>
          <ULink
            v-for="source in asTool(part).output!.results"
            :key="source.link"
            :to="source.link"
            class="flex items-baseline gap-2 text-sm"
          >
            <UIcon name="i-lucide-mail" class="size-3.5 shrink-0 self-center text-dimmed" />
            <span class="truncate font-medium">{{ source.subject }}</span>
            <span class="shrink-0 text-xs text-muted">{{ source.from.split('<')[0] }} · {{ format(new Date(source.date), 'dd MMM yyyy') }}</span>
          </ULink>
        </div>
        <span v-else class="text-xs text-dimmed">No matching mails</span>
      </template>

      <template v-else-if="part.type === 'tool-mail_read'">
        <UChatTool
          v-if="asTool(part).state !== 'output-available'"
          :text="asTool(part).state === 'output-error' ? 'Could not read the mail' : 'Reading mail…'"
          icon="i-lucide-book-open"
          :loading="asTool(part).state !== 'output-error'"
        />
        <ULink
          v-else-if="asTool(part).output?.link"
          :to="asTool(part).output!.link"
          class="flex items-center gap-2 text-xs text-muted"
        >
          <UIcon name="i-lucide-book-open" class="size-3.5" />
          Read “{{ asTool(part).output!.subject }}”
        </ULink>
      </template>
    </template>
  </div>
</template>
