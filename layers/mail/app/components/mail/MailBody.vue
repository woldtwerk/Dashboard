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
let forwarded: { window: Window, handler: (event: KeyboardEvent) => void } | null = null

/** Stop listening to the document that is going away */
function stopForwarding() {
  forwarded?.window.removeEventListener('keydown', forwarded.handler)
  forwarded = null
}

/**
 * Clicking the mail body gives it the keyboard: its keydown events stay inside
 * the frame, so no shortcut of the page would fire. Each key is dispatched on
 * the parent window again — unless the reader is typing inside the frame.
 */
function forwardKeys() {
  stopForwarding()

  const target = frame.value?.contentWindow
  if (!target) {
    return
  }

  const handler = (event: KeyboardEvent) => {
    const element = event.target as HTMLElement | null
    const tag = element?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || element?.isContentEditable) {
      return
    }

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      bubbles: true
    }))
  }

  target.addEventListener('keydown', handler)
  forwarded = { window: target, handler }
}

function disconnect() {
  observer?.disconnect()
  observer = null
  stopForwarding()
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
  // The new document takes the keyboard with it
  forwardKeys()
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
