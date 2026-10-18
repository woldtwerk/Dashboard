import type { H3Event } from 'h3'

/**
 * What a domain has to provide so imgproxy can read one of its originals.
 * `id` is opaque to the image layer: the domain decides what it encodes (the
 * drive layer, for example, packs a service and a path into it) and stays the
 * only code that interprets it.
 */
export interface ImageSourceResult {
  /** The original's bytes, streamed back to imgproxy. */
  body: ReadableStream<Uint8Array> | Buffer
  contentType: string
  /** Byte length when known, so imgproxy can size the download. */
  size?: number
}

export interface ImageSource {
  /** Reads one original. The event is passed for the domain's own logging. */
  load(id: string, event?: H3Event): Promise<ImageSourceResult>
  /**
   * A version token that changes when the original does, or undefined when the
   * client is expected to pass `v` itself. It rides into the signature, so a
   * changed original cannot be served from an old cached entry.
   */
  version?(id: string): string | undefined
}

// Sources are registered by their layer's Nitro plugin during startup, so every
// cluster worker holds the same map. Nothing writes to it per request.
const sources = new Map<string, ImageSource>()

/** Registers a domain's originals under a plain name, e.g. `drive`. */
export function registerImageSource(name: string, source: ImageSource): void {
  sources.set(name, source)
}

/** The source registered under `name`, or undefined when no domain claims it. */
export function getImageSource(name: string): ImageSource | undefined {
  return sources.get(name)
}

/** The registered source names, for diagnostics. */
export function listImageSources(): string[] {
  return [...sources.keys()]
}
