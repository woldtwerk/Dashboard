<script setup lang="ts">
import { isToolUIPart } from 'ai'
import type { UIMessage } from 'ai'

defineProps<{
  message: UIMessage
}>()
</script>

<template>
  <div class="flex flex-col gap-2">
    <template v-for="(part, index) in message.parts" :key="index">
      <!-- The assistant writes Markdown; user text stays literal -->
      <AssistantMarkdown
        v-if="part.type === 'text' && message.role === 'assistant'"
        :text="part.text"
      />

      <p v-else-if="part.type === 'text'" class="whitespace-pre-wrap">
        {{ part.text }}
      </p>

      <!-- Every tool call is visible: a line while running, source cards after -->
      <AssistantToolPart
        v-else-if="isToolUIPart(part)"
        :part="part"
      />
    </template>
  </div>
</template>
