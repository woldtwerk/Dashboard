<script setup lang="ts">
import { cameraSupported, decodeQrFromImage, decodeQrFromVideo } from '../../utils/qr-scan'

/**
 * A text field that can be filled in by scanning a QR code.
 *
 * The code is read from the camera or from a screenshot, decoded here on the
 * device, and handed to `parse`. Everything that decides what a code means
 * lives in the caller: this component only knows how to read one, so a new
 * provider is a new parser rather than another copy of the camera loop.
 */
const props = defineProps<{
  /** Turns a decoded code into the value to store; the empty string is a miss. */
  parse: (payload: string) => string
  /** The placeholder of the field. */
  placeholder?: string
  /** Shown when the code is not one of ours. */
  unrecognizedTitle: string
  /** Shown when a code was recognized. */
  recognizedTitle: string
  /** Applied to a typed value when the field loses focus, e.g. to strip a link. */
  normalize?: (value: string) => string
}>()

const model = defineModel<string>({ default: '' })

const toast = useToast()

const video = useTemplateRef<HTMLVideoElement>('video')
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const cameraOpen = ref(false)

/** The live camera stream, held so it can be stopped again. */
let stream: MediaStream | null = null
let frame: number | null = null

function stopCamera() {
  if (frame !== null) {
    cancelAnimationFrame(frame)
    frame = null
  }
  stream?.getTracks().forEach(track => track.stop())
  stream = null
  cameraOpen.value = false
}

onBeforeUnmount(stopCamera)

async function openCamera() {
  if (!cameraSupported()) {
    toast.add({
      title: 'The camera could not be opened',
      description: 'This page is not allowed to use the camera. Upload an image of the code instead.',
      icon: 'i-lucide-circle-alert',
      color: 'error'
    })
    return
  }

  try {
    stream = await getCameraStream()
    cameraOpen.value = true
    await nextTick()
    if (video.value) {
      video.value.srcObject = stream
      await video.value.play()
      lastDecodedAt = 0
      frame = requestAnimationFrame(pump)
    }
  } catch (error) {
    toast.add({
      title: 'The camera could not be opened',
      description: cameraErrorHint(error),
      icon: 'i-lucide-circle-alert',
      color: 'error'
    })
    stopCamera()
  }
}

/**
 * Opens a camera, preferring the one facing away from the screen.
 *
 * `facingMode` is only a preference: asked for as a requirement it makes the
 * whole request fail on a device without a rear camera — a laptop — where the
 * only camera would have served. So the preferred camera is tried first and
 * any camera is taken when that is not available.
 */
async function getCameraStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'OverconstrainedError') {
      return await navigator.mediaDevices.getUserMedia({ video: true })
    }
    throw error
  }
}

/** What to tell the user about a camera that would not open. */
function cameraErrorHint(error: unknown): string | undefined {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'Allow camera access in your browser.'
    }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return 'No camera was found.'
    }
    if (error.name === 'NotReadableError') {
      return 'Another app is using the camera. Close it and try again.'
    }
  }

  return undefined
}

/** The timestamp of the last frame handed to the decoder. */
let lastDecodedAt = 0

/**
 * How often a frame is decoded, in milliseconds.
 *
 * `requestAnimationFrame` fires up to 60 times a second, and decoding costs far
 * more than drawing one frame. Aiming at a steady rate instead keeps the
 * preview smooth and leaves the processor able to finish a decode before the
 * next frame is due — the opposite ordering is what makes a loop like this
 * appear to hang while a camera stares back at the user.
 */
const DECODE_INTERVAL = 120

function pump(now: number) {
  frame = requestAnimationFrame(pump)

  if (!cameraOpen.value || now - lastDecodedAt < DECODE_INTERVAL) {
    return
  }
  lastDecodedAt = now

  if (!video.value) {
    return
  }

  const payload = decodeQrFromVideo(video.value)
  if (payload) {
    stopCamera()
    applyPayload(payload)
  }
}

function applyPayload(payload: string) {
  const value = props.parse(payload)
  if (!value) {
    // The providers' QR formats are undocumented and have changed between
    // releases, so the raw text is shown: it is what tells a format we do not
    // know yet from a code that simply is not a payment request.
    toast.add({
      title: props.unrecognizedTitle,
      description: payload.slice(0, 160),
      icon: 'i-lucide-circle-alert',
      color: 'error'
    })
    return
  }

  model.value = value
  toast.add({
    title: props.recognizedTitle,
    icon: 'i-lucide-check',
    color: 'success'
  })
}

/** Decodes a screenshot the user picks instead of holding a code to the camera. */
async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }

  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    toast.add({
      title: 'The image could not be opened',
      icon: 'i-lucide-circle-alert',
      color: 'error'
    })
    return
  }

  const payload = decodeQrFromImage(bitmap)
  bitmap.close()

  if (!payload) {
    toast.add({
      title: props.unrecognizedTitle,
      description: 'The image does not contain a readable QR code.',
      icon: 'i-lucide-circle-alert',
      color: 'error'
    })
    return
  }

  applyPayload(payload)
}

function onBlur() {
  if (props.normalize) {
    model.value = props.normalize(model.value)
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      v-if="cameraOpen"
      class="relative overflow-hidden rounded-lg border border-default"
    >
      <!-- eslint-disable-next-line vue/html-self-closing -->
      <video
        ref="video"
        class="w-full"
        playsinline
        muted
      />
      <UButton
        label="Stop"
        icon="i-lucide-x"
        color="neutral"
        size="sm"
        class="absolute inset-e-2 top-2"
        @click="stopCamera"
      />
    </div>

    <div class="flex items-center gap-2">
      <UInput
        v-model="model"
        :placeholder="placeholder"
        class="w-full font-mono"
        @blur="onBlur"
      />
      <UButton
        v-if="!cameraOpen"
        label="Scan"
        icon="i-lucide-scan-line"
        color="neutral"
        variant="outline"
        @click="openCamera"
      />
      <UButton
        v-if="!cameraOpen"
        label="Upload image"
        icon="i-lucide-image-up"
        color="neutral"
        variant="outline"
        @click="fileInput?.click()"
      />
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hidden"
      @change="onFile"
    >
  </div>
</template>
