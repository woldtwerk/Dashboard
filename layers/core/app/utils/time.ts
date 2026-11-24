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

/**
 * Human relative time until a future ISO timestamp against `now`, e.g.
 * `in 2 hours`. A timestamp that has passed or is very close is "now";
 * missing or unparsable input is "unknown".
 */
export function formatUntil(at: string | null | undefined, now: Date): string {
  if (!at) {
    return 'unknown'
  }
  const then = new Date(at).getTime()
  if (Number.isNaN(then)) {
    return 'unknown'
  }

  const seconds = Math.round((then - now.getTime()) / 1000)
  if (seconds <= 45) {
    return 'now'
  }
  if (seconds < 90) {
    return 'in 1 min'
  }

  const minutes = Math.round(seconds / MINUTE)
  if (minutes < 45) {
    return `in ${minutes} min`
  }
  if (minutes < 90) {
    return 'in 1 hour'
  }

  const hours = Math.round(minutes / 60)
  if (hours < 22) {
    return `in ${hours} hours`
  }
  if (hours < 36) {
    return 'tomorrow'
  }

  const days = Math.round(hours / 24)
  if (days < 26) {
    return `in ${days} days`
  }
  if (days < 45) {
    return 'in 1 month'
  }

  const months = Math.round(days / 30)
  if (months < 11) {
    return `in ${months} months`
  }
  if (months < 18) {
    return 'in 1 year'
  }
  return `in ${Math.round(months / 12)} years`
}
