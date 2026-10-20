import { baseMimeType, resolveMimeType } from '../../core/shared/mime'

/** A media type glob: `type/subtype` or `type/*` */
const MIME_GLOB_RE = /^[a-z0-9!#$&^_.+-]+\/(\*|[a-z0-9!#$&^_.+-]+)$/i

export { baseMimeType }

/** Whether one accept entry is a media type or a `type/*` glob */
export function isMimeGlob(value: string): boolean {
  return MIME_GLOB_RE.test(value.trim())
}

/**
 * Whether a file's media type matches any accept glob. An empty or missing list
 * accepts everything; a `type/*` glob matches every subtype of that type. When
 * the type is generic (`application/octet-stream`) or missing, the file name's
 * extension decides, so a video sent as an octet stream still matches `video/*`.
 */
export function matchesMimeGlob(contentType: string | undefined, accept?: readonly string[], filename = ''): boolean {
  if (!accept?.length) {
    return true
  }

  const type = resolveMimeType(contentType, filename)
  return accept.some((glob) => {
    const normalized = glob.trim().toLocaleLowerCase()
    if (!isMimeGlob(normalized)) {
      return false
    }
    const [wantedType, wantedSubtype] = normalized.split('/')
    const [actualType, actualSubtype] = type.split('/')
    return wantedType === actualType && (wantedSubtype === '*' || wantedSubtype === actualSubtype)
  })
}

/**
 * Parses the free-text accept field: comma or whitespace separated globs, with
 * invalid entries dropped so a half-typed value does not silently match nothing.
 */
export function parseMimeGlobs(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map(entry => entry.trim().toLocaleLowerCase()).filter(isMimeGlob))]
}
