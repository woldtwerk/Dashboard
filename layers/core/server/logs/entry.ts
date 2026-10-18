import { z } from 'zod'
import type { LogEntry, LogLevel } from '../../shared/types/logs'

/** The part of consola's log object the logger needs; tests can build it by hand */
export interface ServiceLogObject {
  type: string
  level?: number
  date?: Date
  args?: unknown[]
  message?: string
}

const LEVEL_BY_TYPE: Record<string, LogLevel> = {
  fatal: 'error',
  error: 'error',
  fail: 'error',
  warn: 'warn',
  log: 'info',
  info: 'info',
  success: 'info',
  start: 'info',
  ready: 'info',
  box: 'info',
  debug: 'debug',
  trace: 'debug',
  verbose: 'debug',
  silent: 'debug'
}

const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential/i
const BEARER_VALUE = /^\s*Bearer\s+\S/i
const MAX_DEPTH = 5
const MAX_ARRAY_ITEMS = 50
const MAX_META_BYTES = 4 * 1024

const encoder = new TextEncoder()

function jsonBytes(value: unknown): number {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? 0 : encoder.encode(text).length
  } catch {
    // BigInt or a throwing toJSON; the caller falls back to a bounded preview
    return MAX_META_BYTES + 1
  }
}

/** A secret-looking key wins over its value; a Bearer value is masked wherever it appears. */
function maskString(value: string): string {
  return BEARER_VALUE.test(value) ? '***' : value
}

/** Keeps the serialized meta within the storage budget, without writing invalid JSON. */
function limitSize(value: unknown): unknown {
  if (jsonBytes(value) <= MAX_META_BYTES) {
    return value
  }

  let text: string
  try {
    text = JSON.stringify(value) ?? ''
  } catch {
    return { truncated: true, preview: '…' }
  }

  let end = Math.min(text.length, MAX_META_BYTES)

  while (end > 0) {
    const bounded = { truncated: true, preview: `${text.slice(0, end)}…` }
    if (jsonBytes(bounded) <= MAX_META_BYTES) {
      return bounded
    }
    end -= 64
  }

  return { truncated: true, preview: '…' }
}

/**
 * A recursive copy of a log's meta with secrets replaced by `***`.
 * Bounded in depth, array length and serialized size, because a log line must
 * never grow into something that slows the write path or leaks a credential.
 */
export function maskSecrets(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) {
    return value
  }
  if (typeof value === 'string') {
    return maskString(value)
  }
  if (typeof value !== 'object') {
    if (typeof value === 'bigint') {
      return value.toString()
    }
    if (typeof value === 'symbol' || typeof value === 'function') {
      return String(value)
    }
    return value
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (value instanceof Error) {
    return value.message
  }
  if (seen.has(value)) {
    return '[circular]'
  }
  if (depth >= MAX_DEPTH) {
    return '…'
  }

  seen.add(value)
  let masked: unknown

  if (Array.isArray(value)) {
    masked = value.slice(0, MAX_ARRAY_ITEMS).map(item => maskSecrets(item, depth + 1, seen))
  } else {
    const copy: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor') {
        continue
      }
      copy[key] = SECRET_KEY.test(key) ? '***' : maskSecrets(item, depth + 1, seen)
    }
    masked = copy
  }

  seen.delete(value)

  // Only the whole object has to fit; nested slices stay readable
  return depth === 0 ? limitSize(masked) : masked
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Maps consola's log type onto the four levels the dashboard stores. */
export function toLogLevel(type: string, numericLevel?: number): LogLevel {
  const mapped = LEVEL_BY_TYPE[type]
  if (mapped) {
    return mapped
  }

  // Unknown custom type: fall back to consola's numeric level
  const level = numericLevel ?? 3
  if (level <= 1) {
    return 'error'
  }
  if (level <= 3) {
    return 'info'
  }
  return 'debug'
}

/**
 * Turns one consola log object into a stored entry. Strings and Errors form the
 * message; the first object argument becomes the masked meta.
 */
export function toLogEntry(log: ServiceLogObject, domain: string, service?: string): Omit<LogEntry, 'id'> {
  const parts: string[] = []
  let meta: Record<string, unknown> | undefined

  for (const arg of log.args ?? []) {
    if (arg instanceof Error) {
      parts.push(arg.message)
    } else if (arg && typeof arg === 'object') {
      if (meta) {
        continue
      }
      meta = isPlainObject(arg)
        ? maskSecrets(arg) as Record<string, unknown>
        : { value: maskSecrets(arg) }
    } else if (arg !== undefined && arg !== null) {
      parts.push(String(arg))
    }
  }

  const entry: Omit<LogEntry, 'id'> = {
    at: (log.date ?? new Date()).toISOString(),
    level: toLogLevel(log.type, log.level),
    domain,
    message: parts.join(' ') || log.message || log.type
  }

  if (service) {
    entry.service = service
  }
  if (meta) {
    entry.meta = meta
  }

  return entry
}

/** Message of anything thrown, without a stack or the arguments that produced it */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const logEntrySchema = z.object({
  id: z.number().int(),
  at: z.iso.datetime(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  domain: z.string().min(1),
  service: z.string().min(1).optional(),
  message: z.string(),
  meta: z.record(z.string(), z.unknown()).optional()
})

/** Validates one stream payload; anything malformed is dropped rather than rendered. */
export function parseLogEntry(value: unknown): LogEntry | undefined {
  const result = logEntrySchema.safeParse(value)
  return result.success ? result.data : undefined
}

/** An SSE message carrying one log line. */
export interface SseLogEntry {
  event: 'log'
  data: string
}

/** The wire form of a streamed log line; pure, so the endpoint and its test share it. */
export function formatSseLog(entry: LogEntry): SseLogEntry {
  return { event: 'log', data: JSON.stringify(entry) }
}
