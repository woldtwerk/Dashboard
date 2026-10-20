/**
 * One file a domain can serve, without its bytes. The shape is deliberately
 * generic and matches the mail layer's `MailAttachment` structurally, so a
 * domain can pass its own metadata without core knowing the domain.
 */
export interface FileSourceMeta {
  filename: string
  contentType: string
  size: number
  /** The provider's part identifier, when the source serves single parts */
  part?: string
  /** An inline part already referenced by a body; it is not an attachment */
  inline?: boolean
  /** `Content-ID` of an inline part */
  contentId?: string
}

/** A streamed file and the handle that releases its source when it is done. */
export interface FileSourceFile {
  meta: FileSourceMeta
  stream: ReadableStream<Uint8Array>
  close(): Promise<void>
}
