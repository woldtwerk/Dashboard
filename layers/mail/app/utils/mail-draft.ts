/** The prefix that keeps compose drafts apart from anything else in sessionStorage */
const DRAFT_PREFIX = 'mail-compose:'

/** The key an unsent compose is kept under; `mode`, mail and folder identify it */
export function composeDraftKey(compose: { mode: string, uid?: number, mailbox?: string }): string {
  return `${DRAFT_PREFIX}${compose.mode}:${compose.uid ?? ''}:${compose.mailbox ?? ''}`
}

/** sessionStorage is absent on the server and may be blocked; a draft is best effort */
function storage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

/** The unsent draft kept under a key, or undefined when there is none */
export function readMailDraft<T>(key: string): T | undefined {
  try {
    const raw = storage()?.getItem(key)
    return raw ? JSON.parse(raw) as T : undefined
  } catch {
    return undefined
  }
}

export function writeMailDraft(key: string, draft: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(draft))
  } catch {
    // A full or blocked sessionStorage must not break the composer
  }
}

export function clearMailDraft(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // Best effort, as above
  }
}
