<script setup lang="ts">
import type { ToolSource } from '#layers/core/shared/types/tools'
import { formatToolSourceDate, isPastToolSource, safeToolSourceLink, toolSourceIcon } from '#layers/mail-ai/app/utils/assistant-tools'
import { isExternalAssistantLink } from '#layers/mail-ai/app/utils/markdown-link'

const props = defineProps<{
  source: ToolSource
}>()

const now = useDashboardNow()
const zone = useTimeZone()
const link = computed(() => safeToolSourceLink(props.source.link))
const external = computed(() => link.value ? isExternalAssistantLink(link.value) : false)
const date = computed(() => formatToolSourceDate(props.source.date, zone.value))
const past = computed(() => isPastToolSource(props.source.date, now.value, zone.value))
</script>

<template>
  <ULink
    v-if="link"
    :to="link"
    :target="external ? '_blank' : undefined"
    :rel="external ? 'noopener noreferrer nofollow' : undefined"
    class="flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-sm transition-colors hover:bg-elevated/60"
  >
    <UIcon :name="toolSourceIcon(source.kind)" class="size-3.5 shrink-0 text-dimmed" />
    <span class="min-w-0 flex-1 truncate font-medium">{{ source.title }}</span>
    <span v-if="source.subtitle" class="hidden max-w-40 truncate text-xs text-muted sm:inline">{{ source.subtitle }}</span>
    <span v-if="date" class="shrink-0 text-xs tabular-nums" :class="past ? 'text-dimmed opacity-60' : 'text-muted'">{{ date }}</span>
  </ULink>

  <div v-else class="flex min-w-0 items-center gap-2 px-1.5 py-1 text-sm">
    <UIcon :name="toolSourceIcon(source.kind)" class="size-3.5 shrink-0 text-dimmed" />
    <span class="min-w-0 flex-1 truncate font-medium">{{ source.title }}</span>
    <span v-if="source.subtitle" class="hidden max-w-40 truncate text-xs text-muted sm:inline">{{ source.subtitle }}</span>
    <span v-if="date" class="shrink-0 text-xs tabular-nums" :class="past ? 'text-dimmed opacity-60' : 'text-muted'">{{ date }}</span>
  </div>
</template>
