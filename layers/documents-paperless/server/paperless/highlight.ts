import { HIGHLIGHT_POST_TAG, HIGHLIGHT_PRE_TAG } from '../../../core/shared/highlight'

/** Named entities Paperless' highlights carry; numeric ones are handled below */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
  nbsp: ' '
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    const key = code.toLowerCase()
    if (key in ENTITIES) {
      return ENTITIES[key]!
    }
    try {
      if (key.startsWith('#x')) {
        return String.fromCodePoint(Number.parseInt(key.slice(2), 16))
      }
      if (key.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(key.slice(1), 10))
      }
    } catch {
      // A code point outside Unicode stays as written
    }
    return match
  })
}

const MATCH_SPAN = /^<span\b/i
const CLASS_ATTRIBUTE = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
const SPAN_CLOSE = /^<\/span\s*>/i
const TAG = /<[^>]*>|[^<]+/g

/** Whether a `<span>` tag's class list contains the exact `match` token */
function isMatchSpan(tag: string): boolean {
  const attribute = CLASS_ATTRIBUTE.exec(tag)
  const value = attribute?.[1] ?? attribute?.[2] ?? attribute?.[3] ?? ''
  return value.split(/\s+/).includes('match')
}

/**
 * The Paperless `__search_hit__.highlights` HTML as plain text with the match
 * markers the renderer understands. Every other tag is dropped, script and
 * style blocks go with their content, and an unbalanced match is closed, so the
 * result can only ever be rendered as escaped text.
 */
export function fromPaperlessHighlights(html?: string | null): string | undefined {
  if (!html) {
    return undefined
  }

  const stripped = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')

  let open = 0
  const marked = stripped.replace(TAG, (token) => {
    if (token.charCodeAt(0) === 0x3C) {
      if (MATCH_SPAN.test(token) && isMatchSpan(token)) {
        open++
        return HIGHLIGHT_PRE_TAG
      }
      if (SPAN_CLOSE.test(token)) {
        if (open === 0) {
          return ''
        }
        open--
        return HIGHLIGHT_POST_TAG
      }
      return ''
    }
    return token
  })

  const text = decodeEntities(open > 0 ? marked + HIGHLIGHT_POST_TAG.repeat(open) : marked)
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()

  return text || undefined
}
