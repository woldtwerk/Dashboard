/** Whether a provider failure means the CLI is busy rather than genuinely broken. */
export function isDriveBusy(error: unknown): boolean {
  const status = (error as { status?: number, statusCode?: number } | undefined)?.status
    ?? (error as { statusCode?: number } | undefined)?.statusCode
  if (status === 423 || status === 429) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /\bbusy\b/i.test(message)
}
