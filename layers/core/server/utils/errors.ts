/**
 * User-facing message of an error, with URLs removed: a failed request must not
 * leak the endpoint (or a credential embedded in it) to the client.
 */
export function safeErrorMessage(error: unknown, fallback = 'The request could not be completed'): string {
  const statusMessage = (error as { statusMessage?: unknown })?.statusMessage
  const message = typeof statusMessage === 'string' ? statusMessage : error instanceof Error ? error.message : ''
  return message.replace(/https?:\/\/\S+/gi, '').trim() || fallback
}
