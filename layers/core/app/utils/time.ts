const MINUTE = 60

/**
 * Human relative time of an ISO timestamp against `now`, e.g. `2 min ago`.
 * Negative or unparsable input is treated as "just now"/"unknown".
 */
export function formatRelative(at: string | null | undefined, now: Date): string {
  if (!at) {
    return 'never'
  }
  const then = new Date(at).getTime()
  if (Number.isNaN(then)) {
    return 'unknown'
  }

  const seconds = Math.round((now.getTime() - then) / 1000)
  if (seconds < 45) {
    return 'just now'
  }
  if (seconds < 90) {
    return '1 min ago'
  }

  const minutes = Math.round(seconds / MINUTE)
  if (minutes < 45) {
    return `${minutes} min ago`
  }
  if (minutes < 90) {
    return '1 hour ago'
  }

  const hours = Math.round(minutes / 60)
  if (hours < 22) {
    return `${hours} hours ago`
  }
  if (hours < 36) {
    return 'yesterday'
  }

  const days = Math.round(hours / 24)
  if (days < 26) {
    return `${days} days ago`
  }
  if (days < 45) {
    return '1 month ago'
  }

  const months = Math.round(days / 30)
  if (months < 11) {
    return `${months} months ago`
  }
  if (months < 18) {
    return '1 year ago'
  }
  return `${Math.round(months / 12)} years ago`
}
