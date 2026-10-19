<script setup lang="ts">
import { renderAssistantMarkdown } from '#layers/mail-ai/app/utils/markdown'

const props = defineProps<{
  text: string
}>()

// markdown-it runs with `html: false`, so raw HTML in the model's answer is
// escaped by `renderAssistantMarkdown` before it reaches v-html.
const html = computed(() => renderAssistantMarkdown(props.text))
</script>

<template>
  <!-- eslint-disable vue/no-v-html -- renderAssistantMarkdown escapes raw HTML -->
  <div
    class="text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:border-default [&_blockquote]:ps-3 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-elevated [&_code]:px-1 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border-b [&_td]:border-default [&_td]:py-1 [&_td]:pe-3 [&_th]:border-b [&_th]:border-default [&_th]:py-1 [&_th]:pe-3 [&_th]:text-left [&_th]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:ps-5"
    v-html="html"
  />
  <!-- eslint-enable vue/no-v-html -->
</template>
