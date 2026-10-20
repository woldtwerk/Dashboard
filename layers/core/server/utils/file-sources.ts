import type { FileSourceFile, FileSourceMeta } from '../../shared/types/file-sources'

/**
 * A domain that serves files for other layers, e.g. mail attachments for the
 * drive import. `ref` is the domain's own opaque reference (the mail layer packs
 * an entity key into it); core never interprets it.
 */
export interface FileSource {
  /** Opens one part, or null when the ref/part does not name a servable file */
  open(ref: string, part: string): Promise<FileSourceFile | null>
  /** The files of the ref, when the source can enumerate them */
  list?(ref: string): Promise<FileSourceMeta[]>
}

// Sources are registered by their layer's Nitro plugin during startup, so every
// cluster worker holds the same map. Nothing writes to it per request.
const sources = new Map<string, FileSource>()

/** Registers a domain's files under a plain name, e.g. `mail`. */
export function registerFileSource(name: string, source: FileSource): void {
  sources.set(name, source)
}

/** The source registered under `name`, or undefined when no domain claims it. */
export function getFileSource(name: string): FileSource | undefined {
  return sources.get(name)
}

/** The registered source names, for diagnostics. */
export function listFileSources(): string[] {
  return [...sources.keys()]
}

/** Reads a streamed file into memory, e.g. for an upload that needs its bytes. */
export async function readFileSource(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
