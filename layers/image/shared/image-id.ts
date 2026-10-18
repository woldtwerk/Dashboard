/**
 * Ids of image originals. An id is opaque to the image layer — each domain
 * encodes whatever its `load()` needs — but it travels in a URL path, so its
 * `/` separated segments are encoded one by one: a literal `/` is the
 * separator, everything inside a segment is escaped.
 */
export function encodeImageId(id: string): string {
  return id.split('/').map(encodeURIComponent).join('/')
}

/** The inverse of {@link encodeImageId}, for a raw (still encoded) route param. */
export function decodeImageId(raw: string | undefined): string {
  if (!raw) {
    return ''
  }
  try {
    return decodeURIComponent(raw)
  } catch {
    return ''
  }
}
