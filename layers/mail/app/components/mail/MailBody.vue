<script setup lang="ts">
import { contentHeight } from '#layers/mail/app/utils/mail-frame'

const props = defineProps<{
  html?: string
  text?: string
  /** Opt-in per message: loading remote images reveals to the sender that the mail was opened */
  allowRemoteImages?: boolean
}>()

// Untrusted HTML is rendered in a sandboxed iframe with scripts disabled. The injected
// CSP (`default-src 'none'`) blocks all remote content, so tracking pixels and external
// resources never load. `allow-same-origin` lets the parent read the frame's document to
// measure its content; without `allow-scripts` the document cannot run code, so it can
// never reach back into the parent.
const srcdoc = computed(() => props.html && [
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:${props.allowRemoteImages ? ' https:' : ''}; font-src data:">`,
  '<meta name="referrer" content="no-referrer">',
  '<base target="_blank">',
  '<style>html { color-scheme: light; } html, body { overflow: hidden; } body { margin: 0; font-family: sans-serif; overflow-wrap: anywhere; } img { max-width: 100%; height: auto; }</style>',
  props.html
].join(''))

const frame = ref<HTMLIFrameElement | null>(null)
let observer: ResizeObserver | null = null

function disconnect() {
  observer?.disconnect()
  observer = null
}

// The document's scrollHeight never reports less than the frame's own viewport, so the
// frame is collapsed first: that measures the content and lets a mail shrink again.
function measure() {
  const element = frame.value
  const doc = element?.contentDocument
  if (!element || !doc) {
    return
  }

  element.style.height = '0px'
  element.style.height = `${contentHeight(doc)}px`
}

// Late images, fonts and a width change resize the content without a load event
function observe() {
  measure()

  const doc = frame.value?.contentDocument
  disconnect()
  if (!doc?.documentElement) {
    return
  }

  observer = new ResizeObserver(measure)
  observer.observe(doc.documentElement)
  if (doc.body) {
    observer.observe(doc.body)
  }
}

onBeforeUnmount(disconnect)

// A new srcdoc loads a new document; the old observer must not keep measuring it
watch(srcdoc, () => {
  disconnect()
  if (frame.value) {
    frame.value.style.height = '0px'
  }
})
</script>

<template>
  <iframe
    v-if="srcdoc"
    ref="frame"
    :srcdoc="srcdoc"
    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    referrerpolicy="no-referrer"
    title="Message content"
    class="block w-full border-0 bg-white"
    style="height: 0px"
    @load="observe"
  />
  <p v-else class="whitespace-pre-wrap p-4 sm:p-6">
    {{ text }}
  </p>
</template>
