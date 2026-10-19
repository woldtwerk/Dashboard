import type { ToolSource } from '#layers/core/shared/types/tools'
import type { AssistantMailSource } from '#layers/mail-ai/shared/types/assistant'
import { isSafeAssistantLink } from '#layers/mail-ai/app/utils/markdown-link'
import { formatZoned } from '#layers/core/shared/date-format'

/**
 * Client-side view of a tool part and its result items. Everything here works
 * from the generic `ToolSource` contract, so no domain logic lives in the
 * components. Old stored messages only carry the previous mail shape; the
 * legacy helpers below keep them readable.
 */

/** The arrays a tool output may hold, newest shape and old shape alike. */
const RESULT_ARRAY_KEYS = ['results', 'documents', 'events', 'contacts', 'entries', 'calendars', 'people', 'nodes'] as const

const KIND_ICONS: Record<string, string> = {
  mail: 'i-lucide-mail',
  document: 'i-lucide-file-text',
  event: 'i-lucide-calendar',
  calendar: 'i-lucide-calendar',
  contact: 'i-lucide-user',
  person: 'i-lucide-user-round',
  file: 'i-lucide-file',
  folder: 'i-lucide-folder'
}

const KIND_NOUNS: Record<string, { one: string, many: string }> = {
  mail: { one: 'mail', many: 'mails' },
  document: { one: 'document', many: 'documents' },
  event: { one: 'event', many: 'events' },
  calendar: { one: 'calendar', many: 'calendars' },
  contact: { one: 'contact', many: 'contacts' },
  person: { one: 'person', many: 'people' },
  file: { one: 'file', many: 'files' },
  folder: { one: 'folder', many: 'folders' }
}

const TOOL_VERBS: Record<string, string> = {
  search: 'Searching',
  read: 'Reading',
  get: 'Looking up',
  info: 'Reading',
  list: 'Listing',
  find: 'Looking up',
  create: 'Creating',
  update: 'Updating',
  add: 'Adding',
  move: 'Moving',
  rename: 'Renaming',
  delete: 'Deleting',
  trash: 'Trashing',
  send: 'Sending',
  set: 'Updating'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isToolSource(value: unknown): value is ToolSource {
  return isRecord(value) && typeof value.kind === 'string' && typeof value.title === 'string'
}

function normalizeSource(source: ToolSource): ToolSource {
  return {
    kind: source.kind,
    title: source.title,
    ...(source.subtitle ? { subtitle: source.subtitle } : {}),
    ...(source.date ? { date: source.date } : {}),
    ...(source.link ? { link: source.link } : {})
  }
}

/** The legacy mail source shape stored before the tool-source contract. */
function legacyMailSource(mail: Partial<AssistantMailSource>): ToolSource[] {
  if (!mail.subject || !mail.link) {
    return []
  }

  return [{
    kind: 'mail',
    title: mail.subject,
    ...(mail.from ? { subtitle: mail.from } : {}),
    ...(mail.date ? { date: mail.date } : {}),
    link: mail.link
  }]
}

function legacyToolSources(toolName: string, output: unknown): ToolSource[] {
  if (!isRecord(output)) {
    return []
  }

  if (toolName === 'mail_search' && Array.isArray(output.results)) {
    return (output.results as Partial<AssistantMailSource>[]).flatMap(legacyMailSource)
  }

  if (toolName === 'mail_read') {
    return legacyMailSource(output as Partial<AssistantMailSource>)
  }

  return []
}

/** The source cards of a tool part, from the new contract or the old mail shape. */
export function toolSources(toolName: string, output: unknown): ToolSource[] {
  if (!isRecord(output)) {
    return []
  }

  if (Array.isArray(output.sources)) {
    return output.sources.filter(isToolSource).map(normalizeSource)
  }

  return legacyToolSources(toolName, output)
}

/** How many items an old tool output lists, when it carries no source cards. */
export function toolResultCount(output: unknown): number {
  if (!isRecord(output)) {
    return 0
  }

  for (const key of RESULT_ARRAY_KEYS) {
    const value = output[key]
    if (Array.isArray(value)) {
      return value.length
    }
  }

  return typeof output.count === 'number' ? output.count : 0
}

/** The icon of a source kind; unknown kinds get a generic file icon. */
export function toolSourceIcon(kind: string): string {
  return KIND_ICONS[kind] ?? 'i-lucide-file'
}

/** "Searching documents…" while a tool runs, derived from its name alone. */
export function toolProgressText(toolName: string): string {
  const parts = toolName.split('_')
  const verbIndex = parts.findIndex(part => part in TOOL_VERBS)

  if (verbIndex < 0) {
    return `Running ${toolName}…`
  }

  const verb = TOOL_VERBS[parts[verbIndex]!]!
  const object = parts.filter((_, index) => index !== verbIndex).join(' ')
  return object ? `${verb} ${object}…` : `${verb}…`
}

/** "Found 3 documents" from the source cards, with a fallback for old output. */
export function toolResultText(sources: ToolSource[], fallbackCount = 0): string {
  const kind = sources[0]?.kind
  const nouns = kind ? KIND_NOUNS[kind] : undefined
  const count = sources.length || fallbackCount

  if (!nouns) {
    return `Found ${count} ${count === 1 ? 'result' : 'results'}`
  }

  return `Found ${count} ${count === 1 ? nouns.one : nouns.many}`
}

/** The result line of a tool that returned items but no source cards. */
export function toolFallbackText(output: unknown): string {
  const count = toolResultCount(output)
  return count ? `Found ${count} ${count === 1 ? 'result' : 'results'}` : 'Tool finished'
}

/** A `YYYY-MM-DD` source is a calendar day already, so it must not shift with a zone. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** A source date as a short day in `zone`, or undefined when it cannot be read. */
export function formatToolSourceDate(date: string | undefined, zone: string): string | undefined {
  if (!date) {
    return undefined
  }

  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) {
    return undefined
  }

  return formatZoned(parsed, DATE_ONLY.test(date) ? 'UTC' : zone, 'dd MMM yyyy')
}

/** Whether a source date is before today in `zone`, so the UI can dim it. */
export function isPastToolSource(date: string | undefined, now: Date, zone: string): boolean {
  if (!date) {
    return false
  }

  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) {
    return false
  }

  const day = DATE_ONLY.test(date) ? date : formatZoned(parsed, zone, 'yyyy-MM-dd')
  return day < formatZoned(now, zone, 'yyyy-MM-dd')
}

/** A source link that may be rendered, or undefined when it is not safe. */
export function safeToolSourceLink(link: string | undefined): string | undefined {
  return isSafeAssistantLink(link) ? link.trim() : undefined
}
