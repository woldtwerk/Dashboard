/**
 * Reading a payment QR off the camera or a screenshot.
 *
 * The code is decoded here, on the device, and only the value a caller's parser
 * keeps is ever sent on. Nothing is uploaded.
 */

import decodeQR from 'qr/decode.js'

/**
 * The widest edge a frame is decoded at, in pixels.
 *
 * A camera hands over 1080p or more, but a QR only needs so many pixels and
 * every extra one is copied and scanned on each frame. Capping the long edge
 * keeps the code readable while the loop stays fast enough to catch a steady
 * moment.
 */
const MAX_DECODE_EDGE = 640

/**
 * The widest edge an uploaded image is decoded at, in pixels.
 *
 * A screenshot can hold the code in a corner of a desktop-sized image, so the
 * cap is higher than a camera frame's. It is decoded once and may spend every
 * retry, but the edge still has to be bounded: a 6K screenshot would otherwise
 * be copied pixel by pixel for no gain.
 */
const MAX_IMAGE_EDGE = 1600

/**
 * A canvas and its context, reused across frames.
 *
 * `getImageData` wants a context created with `willReadFrequently`, and
 * allocating a canvas per frame gives the browser no chance to reuse the
 * backing store.
 */
let scratch: { canvas: HTMLCanvasElement, context: CanvasRenderingContext2D } | null = null

function scratchContext(width: number, height: number): CanvasRenderingContext2D | null {
  scratch ??= (() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    return context ? { canvas, context } : null
  })()

  if (!scratch) {
    return null
  }
  if (scratch.canvas.width !== width || scratch.canvas.height !== height) {
    scratch.canvas.width = width
    scratch.canvas.height = height
  }

  return scratch.context
}

function scaledSize(width: number, height: number, maxEdge: number): { width: number, height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

function decodeImageData(data: ImageData, effort = false): string | null {
  try {
    // RGBA is detected from the data length. A camera frame keeps the default
    // effort tier and time limit, since a miss has to stay cheap; a screenshot
    // is decoded once and can afford every retry.
    return effort
      ? decodeQR({ width: data.width, height: data.height, data: data.data }, { effort: Infinity, timeLimit: Infinity })
      : decodeQR({ width: data.width, height: data.height, data: data.data })
  } catch {
    return null
  }
}

/**
 * Decodes a QR from a live video frame.
 *
 * `decodeQR` throws when the frame holds no code, which is the common case
 * while the user is still lining the camera up, so that is the miss.
 *
 * @param video
 *   The video element the camera streams into.
 * @returns
 *   The text of the QR, or null when the frame holds none.
 */
export function decodeQrFromVideo(video: HTMLVideoElement): string | null {
  if (video.readyState < video.HAVE_CURRENT_DATA || video.videoWidth === 0) {
    return null
  }

  const size = scaledSize(video.videoWidth, video.videoHeight, MAX_DECODE_EDGE)
  const context = scratchContext(size.width, size.height)
  if (!context) {
    return null
  }

  context.drawImage(video, 0, 0, size.width, size.height)

  return decodeImageData(context.getImageData(0, 0, size.width, size.height))
}

/**
 * Decodes a QR from an image the user picked, e.g. a screenshot of the code
 * from the provider's app.
 *
 * The image is drawn at a capped size, so a large screenshot does not turn
 * into a slow copy of tens of megapixels, but the cap is higher than a camera
 * frame's because the code may sit in a corner of the screenshot.
 *
 * @param image
 *   The decoded image bitmap.
 * @returns
 *   The text of the QR, or null when the image holds none.
 */
export function decodeQrFromImage(image: ImageBitmap): string | null {
  if (!image.width || !image.height) {
    return null
  }

  const size = scaledSize(image.width, image.height, MAX_IMAGE_EDGE)
  const context = scratchContext(size.width, size.height)
  if (!context) {
    return null
  }

  context.drawImage(image, 0, 0, size.width, size.height)

  return decodeImageData(context.getImageData(0, 0, size.width, size.height), true)
}

/**
 * Whether a camera could be opened here at all.
 *
 * Three things have to hold: the API has to exist, the document has to be a
 * secure context, and a Permissions Policy has to grant `camera` to it. A page
 * shown inside an iframe whose `allow` list does not name the camera is
 * refused before `getUserMedia` is reached — "camera is not allowed in this
 * document" — and no amount of retrying changes that, so the reason is worth
 * telling apart from a device that simply has none.
 *
 * @returns
 *   TRUE when the camera can be tried, FALSE when it cannot be at all.
 */
export function cameraSupported(): boolean {
  if (!import.meta.client || !navigator.mediaDevices?.getUserMedia) {
    return false
  }
  if (!window.isSecureContext) {
    return false
  }

  // A missing policy is a grant; a present one has to name `camera` or a
  // wildcard. `camera=()` is the deny-all form this looks for. Neither the
  // standard `permissionsPolicy` nor the older `featurePolicy` is in the DOM
  // typings yet, hence the narrow shape.
  const container = document as Document & {
    permissionsPolicy?: { allowsFeature(feature: string): boolean }
    featurePolicy?: { allowsFeature(feature: string): boolean }
  }
  const policy = container.permissionsPolicy ?? container.featurePolicy
  if (policy && !policy.allowsFeature('camera')) {
    return false
  }

  return true
}
