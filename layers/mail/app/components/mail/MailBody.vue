<script setup lang="ts">
const props = defineProps<{
  html?: string
  text?: string
  /** Opt-in per message: loading remote images reveals to the sender that the mail was opened */
  allowRemoteImages?: boolean
}>()

// Untrusted HTML is rendered in a sandboxed iframe (no scripts, no same-origin access).
// The CSP blocks all remote content by default, so tracking pixels and external resources never load.
const srcdoc = computed(() => props.html && [
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:${props.allowRemoteImages ? ' https:' : ''}; font-src data:">`,
  '<meta name="referrer" content="no-referrer">',
  '<base target="_blank">',
  '<style>html { color-scheme: light; } body { margin: 0; font-family: sans-serif; }</style>',
  props.html
].join(''))
</script>

<template>
  <iframe
    v-if="srcdoc"
    :srcdoc="srcdoc"
    sandbox="allow-popups allow-popups-to-escape-sandbox"
    referrerpolicy="no-referrer"
    title="Message content"
    class="size-full bg-white"
  />
  <p v-else class="whitespace-pre-wrap p-4 sm:p-6">
    {{ text }}
  </p>
</template>
