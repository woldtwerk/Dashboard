<script setup lang="ts">
import {
  toolFallbackText,
  toolProgressText,
  toolResultCount,
  toolResultText,
  toolSourceIcon,
  toolSources
} from '#layers/mail-ai/app/utils/assistant-tools'

const props = defineProps<{
  part: unknown
}>()

interface ToolPart {
  type?: string
  state?: string
  output?: unknown
  errorText?: string
  toolName?: string
}

/**
 * A tool part, from the AI SDK shape (`tool-<name>`) or a dynamic tool part.
 * No domain is known here; every result item comes from `output.sources`.
 */
const tool = computed(() => {
  const part = props.part as ToolPart | undefined
  if (!part?.type) {
    return undefined
  }

  const name = part.type === 'dynamic-tool'
    ? part.toolName
    : part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : undefined

  return name ? { name, state: part.state ?? 'input-available', output: part.output, errorText: part.errorText } : undefined
})

const FINISHED_STATES = ['output-available', 'output-error', 'output-denied']

const running = computed(() => !!tool.value && !FINISHED_STATES.includes(tool.value.state))
const failed = computed(() => tool.value?.state === 'output-error')
const sources = computed(() => tool.value ? toolSources(tool.value.name, tool.value.output) : [])
const resultText = computed(() => toolResultText(sources.value, toolResultCount(tool.value?.output)))
</script>

<template>
  <UChatTool
    v-if="running"
    :text="toolProgressText(tool!.name)"
    icon="i-lucide-loader-circle"
    loading
  />

  <UChatTool
    v-else-if="failed"
    :text="tool?.errorText || 'The tool could not run'"
    icon="i-lucide-circle-alert"
  />

  <UChatTool
    v-else-if="sources.length"
    :text="resultText"
    :icon="toolSourceIcon(sources[0]!.kind)"
    chevron="leading"
    default-open
  >
    <div class="flex flex-col gap-0.5 p-1">
      <AssistantToolSource
        v-for="(source, index) in sources"
        :key="`${source.kind}-${index}`"
        :source="source"
      />
    </div>
  </UChatTool>

  <UChatTool
    v-else
    :text="toolFallbackText(tool?.output)"
    icon="i-lucide-check"
  />
</template>
