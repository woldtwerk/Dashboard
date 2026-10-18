export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** One structured log line of a domain/service, as stored and streamed */
export interface LogEntry {
  id: number
  /** ISO time */
  at: string
  level: LogLevel
  /** e.g. 'mail', 'calendar', 'core' */
  domain: string
  /** Service id; absent for domain-wide lines */
  service?: string
  message: string
  /** Small JSON object; secrets are masked before storage */
  meta?: Record<string, unknown>
}

/** One finished background sync run */
export interface SyncRun {
  domain: string
  service: string
  /** ISO start time */
  startedAt: string
  durationMs: number
  ok: boolean
  /** Objects added/changed/removed in the run */
  changed: number
}

export interface LogQuery {
  domains?: string[]
  services?: string[]
  levels?: LogLevel[]
  /** Return entries with id < before (pagination) */
  before?: number
  limit?: number
}
