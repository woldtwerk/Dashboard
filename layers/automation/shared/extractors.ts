/**
 * Reading values out of an item and rendering them into notification templates.
 *
 * Everything here is pure: a workflow's `extract` and `notify` actions are authored
 * by the dashboard owner and run by the action runner, so the rules — which
 * variable names are allowed, how a template renders, what a regex may cost — are
 * tested without a mail provider, a provider or the server.
 */

// --- Variables and templates ----------------------------------------------

/** A variable name: lower-case, starts with a letter, at most 32 characters */
export const VARIABLE_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/

/** Whether `name` is a usable run-variable name */
export function isVariableName(name: string): boolean {
  return VARIABLE_NAME_RE.test(name)
}

/** The values every template may use without an `extract` action */
export const BUILTIN_VARIABLES = ['title', 'subject', 'from', 'workflow'] as const

/** A `{{name}}` placeholder; only valid variable names are placeholders */
const TEMPLATE_VARIABLE_RE = /\{\{\s*([a-z][a-z0-9_]{0,31})\s*\}\}/g

/**
 * The variable names a text references, in order and without duplicates. Text
 * that is not a valid `{{variable}}` (e.g. `{{Total}}`) is left untouched.
 */
export function templateVariables(text: string): string[] {
  return [...new Set([...text.matchAll(TEMPLATE_VARIABLE_RE)].map(match => match[1]!))]
}

/**
 * Renders `{{name}}` placeholders from `variables`; an unknown name becomes an
 * empty string, so a half-authored template never leaks a placeholder to the user.
 */
export function renderTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(TEMPLATE_VARIABLE_RE, (_placeholder, name: string) => variables[name] ?? '')
}

// --- Regex extractor ------------------------------------------------------

/** A regex may not be longer than this; it is authored by the dashboard owner */
export const MAX_EXTRACT_PATTERN_LENGTH = 200

/** Only this much of an item is matched, so a long body cannot be abused */
export const MAX_EXTRACT_INPUT_LENGTH = 20_000

/**
 * Compiles an owner-authored pattern, case-insensitively. Throws for an invalid
 * pattern, so validation can report it on the extract node.
 *
 * ReDoS note: JavaScript has no cheap per-regex timeout, and patterns are authored
 * by the dashboard owner only (the builder is not exposed to untrusted users).
 * The guards here — a 200-character pattern and 20 000 characters of input — keep
 * the worst case small; a pattern that catastrophically backtracks is still
 * possible in principle. Moving the match into a worker would be the next step if
 * workflows ever become user-supplied.
 */
export function compileExtractPattern(pattern: string): RegExp {
  return new RegExp(pattern, 'i')
}

/**
 * The first capture group (or the whole match) of `pattern` in `input`, or
 * `undefined` when nothing matches. Case-insensitive; the input is capped.
 */
export function extractWithRegex(pattern: string, input: string): string | undefined {
  if (!pattern || pattern.length > MAX_EXTRACT_PATTERN_LENGTH) {
    return undefined
  }

  let regex: RegExp
  try {
    regex = compileExtractPattern(pattern)
  } catch {
    return undefined
  }

  const match = regex.exec(input.slice(0, MAX_EXTRACT_INPUT_LENGTH))
  if (!match) {
    return undefined
  }
  return match[1] ?? match[0]
}

/** The validation error of an extract action, or `undefined` when it is usable */
export function extractActionError(
  action: { variable: string, extractor: 'login-code' | 'regex', pattern?: string }
): string | undefined {
  if (!isVariableName(action.variable)) {
    return `"${action.variable}" is not a valid variable name`
  }
  if (action.extractor !== 'regex') {
    return undefined
  }
  const pattern = action.pattern ?? ''
  if (!pattern) {
    return 'The regex extractor needs a pattern'
  }
  if (pattern.length > MAX_EXTRACT_PATTERN_LENGTH) {
    return `The pattern must be at most ${MAX_EXTRACT_PATTERN_LENGTH} characters`
  }
  try {
    compileExtractPattern(pattern)
  } catch {
    return 'The pattern is not a valid regular expression'
  }
  return undefined
}

// --- Login / verification codes -------------------------------------------

/** Characters a code is made of */
const CODE_CHARS = 'A-Z0-9'

/** A single run of code characters: 4–10 of them */
const SINGLE = `[${CODE_CHARS}]{4,10}`

/**
 * Two runs joined by one separator. A hyphen joins alphanumerics (`ABC-123`,
 * `G-123456`), a space only joins digit runs (`482 913`), so a sentence like
 * `code is 482` cannot be read as one token.
 */
const GROUPED = `[${CODE_CHARS}]{1,9}-[${CODE_CHARS}]{1,9}|\\d{2,5} \\d{2,5}`

const CANDIDATE_RE = new RegExp(`(?<![A-Za-z0-9])(?:${GROUPED}|${SINGLE})(?![A-Za-z0-9])`, 'g')

/**
 * The words that mark a code. German and English; `\b`-like edges are applied in
 * the regex so `PIN` inside `shipping` or `TAN` inside `stand` is not a keyword.
 */
const KEYWORDS = [
  'bestätigungscode', 'bestätigungs-code', 'sicherheitscode', 'sicherheits-code',
  'sicherheitstoken', 'verifizierungscode', 'verifizierungs-code', 'einmalcode',
  'einmal-code', 'anmeldecode', 'zugangscode', 'passcode', 'verification',
  'one-time', 'one time', 'onetime', 'sign-in', 'sign in', 'log-in', 'log in',
  'security', 'login', 'token', 'code', 'otp', 'pin', 'tan'
]

const KEYWORD_RE = new RegExp(`(?<![a-z0-9äöüß])(${KEYWORDS.join('|')})(?![a-z0-9äöüß])`, 'gi')

/** How far from a keyword a code may sit and still count as "close to" it */
const KEYWORD_WINDOW = 48

/** Month names in both languages, used to recognise a year that stands next to one */
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'januar', 'februar', 'märz', 'maerz', 'mai', 'juni', 'juli', 'oktober', 'dezember'
]

const MONTH_RE = new RegExp(`(?<![a-z])(?:${MONTHS.join('|')})(?![a-z])`, 'gi')

const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\b\d{2}\.\d{2}\.\b/g
const TIME_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g
const URL_RE = /https?:\/\/\S+|www\.\S+/gi
const TAG_RE = /<[^>]*>/g

/** Entities common in HTML-ish mail bodies; everything else is left as-is. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
}

/** Strips markup and the noise (URLs, dates, times) that could look code-like. */
function sanitize(text: string): string {
  return decodeEntities(text.replace(TAG_RE, ' '))
    .replace(URL_RE, ' ')
    .replace(DATE_RE, ' ')
    .replace(TIME_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether a 4-digit number is a year rather than a code */
function isYear(digits: string): boolean {
  return /^(?:19|20)\d{2}$/.test(digits)
}

/** A code candidate with where it sits and how far its nearest keyword is */
interface Candidate {
  code: string
  start: number
  end: number
  /** A keyword ends before the candidate (the candidate follows a keyword) */
  afterKeyword: boolean
  /** Distance in characters to the nearest keyword */
  distance: number
}

function nearestKeyword(
  start: number,
  end: number,
  keywords: Array<{ start: number, end: number }>
): { afterKeyword: boolean, distance: number } | undefined {
  let best: { afterKeyword: boolean, distance: number } | undefined

  for (const keyword of keywords) {
    const after = keyword.end <= start
    const distance = after
      ? start - keyword.end
      : (keyword.start >= end ? keyword.start - end : 0)
    if (!best || distance < best.distance) {
      best = { afterKeyword: after, distance }
    }
  }

  return best
}

/**
 * The login / verification code in a mail body, normalized (separator removed,
 * upper-cased), or `undefined` when there is none. Prefers a code just after a
 * keyword, a 6-digit code among those, and the nearest one.
 */
export function extractLoginCode(text: string): string | undefined {
  if (!text) {
    return undefined
  }

  const clean = sanitize(text)
  if (!clean) {
    return undefined
  }

  const keywords: Array<{ start: number, end: number }> = []
  for (const match of clean.matchAll(KEYWORD_RE)) {
    keywords.push({ start: match.index, end: match.index + match[0].length })
  }
  if (!keywords.length) {
    return undefined
  }

  // A year next to a month is a date, not a code; drop those spans up front.
  const dateYears = new Set<number>()
  for (const month of clean.matchAll(MONTH_RE)) {
    const window = clean.slice(month.index, month.index + month[0].length + 12)
    const year = /\b((?:19|20)\d{2})\b/.exec(window)
    if (year) {
      dateYears.add(month.index + year.index)
    }
  }

  const candidates: Candidate[] = []
  for (const match of clean.matchAll(CANDIDATE_RE)) {
    const raw = match[0]
    const code = raw.replace(/[- ]/g, '').toUpperCase()
    if (code.length < 4 || code.length > 10 || !/\d/.test(code) || !/^[A-Z0-9]+$/.test(code)) {
      continue
    }
    // A bare year (and a year next to a month) is never a code
    if (code.length === 4 && isYear(code)) {
      continue
    }
    if (dateYears.has(match.index)) {
      continue
    }
    // `12-03` reads as a date fragment, not a code
    if (/^\d{2}[- ]\d{2}$/.test(raw)) {
      continue
    }

    const near = nearestKeyword(match.index, match.index + raw.length, keywords)
    if (!near || near.distance > KEYWORD_WINDOW) {
      continue
    }

    candidates.push({
      code,
      start: match.index,
      end: match.index + raw.length,
      afterKeyword: near.afterKeyword,
      distance: near.distance
    })
  }

  if (!candidates.length) {
    return undefined
  }

  const sixDigits = candidates.filter(candidate => /^\d{6}$/.test(candidate.code))
  const after = candidates.filter(candidate => candidate.afterKeyword)
  const pool = (after.length ? after : candidates).slice()
  const sixDigitPool = pool.filter(candidate => sixDigits.includes(candidate))

  const ranked = (sixDigitPool.length ? sixDigitPool : pool)
    .sort((a, b) => a.distance - b.distance || a.start - b.start)

  return ranked[0]!.code
}

// --- Modal references -----------------------------------------------------

/**
 * The event type a run with a notification modal announces. A modal is addressed
 * by its run and node, in one string the URL and the domain event both carry:
 * `<runId>.<nodeId>`. Keeping the format here means the server, the URL and the
 * live event cannot drift apart.
 */
export const MODAL_EVENT_TYPE = 'modal'

/** The type and resource prefix an earlier release used; accepted for open tabs */
const LEGACY_MODAL_EVENT_TYPE = 'changed'
const LEGACY_MODAL_EVENT_PREFIX = 'modal:'

/** The `?automation-modal=` value and event resource body of one modal */
export function modalRef(runId: string, nodeId: string): string {
  return `${runId}.${nodeId}`
}

/** The run and node of a modal reference, or `undefined` when it is malformed */
export function parseModalRef(value: string | undefined): { runId: string, nodeId: string } | undefined {
  if (!value) {
    return undefined
  }
  const dot = value.indexOf('.')
  if (dot <= 0 || dot === value.length - 1) {
    return undefined
  }
  return { runId: value.slice(0, dot), nodeId: value.slice(dot + 1) }
}

/** The domain-event resource a run with a modal announces */
export function modalEventResource(runId: string, nodeId: string): string {
  return modalRef(runId, nodeId)
}

/**
 * The modal a domain event points at, or `undefined` for any other event. A
 * `modal` event carries the bare reference; the `changed` event with the old
 * `modal:` resource is still accepted while tabs from the previous release stay open.
 */
export function modalFromEvent(type: string, resource: string | undefined): { runId: string, nodeId: string } | undefined {
  if (type === MODAL_EVENT_TYPE) {
    return parseModalRef(resource)
  }
  if (type === LEGACY_MODAL_EVENT_TYPE && resource?.startsWith(LEGACY_MODAL_EVENT_PREFIX)) {
    return parseModalRef(resource.slice(LEGACY_MODAL_EVENT_PREFIX.length))
  }
  return undefined
}
