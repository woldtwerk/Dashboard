/** How far a service's search index has come, for the progress bar */
export interface MailIndexProgress {
  /** Whole percent, 0..100; 100 once the service is complete */
  percent: number
  /** No total to measure against yet, so the bar shows activity instead of a share */
  indeterminate: boolean
  /** Indexed count against the total, e.g. "19,556 of 25,012" */
  label: string
}

export interface MailIndexProgressInput {
  indexed: number
  /** Messages the provider reported for the indexed folders; null until a sync listed them */
  total: number | null
  complete: boolean
}

const COUNT = new Intl.NumberFormat('en')

/**
 * The share of a service's mail that is indexed. A complete service reads 100 %
 * whatever the counts say, so a stale total cannot leave the bar short of full.
 */
export function indexProgress({ indexed, total, complete }: MailIndexProgressInput): MailIndexProgress {
  if (!total || total <= 0) {
    return { percent: complete ? 100 : 0, indeterminate: !complete, label: `${COUNT.format(indexed)} messages` }
  }

  const percent = complete ? 100 : Math.min(100, Math.max(0, Math.round((indexed / total) * 100)))

  return { percent, indeterminate: false, label: `${COUNT.format(indexed)} of ${COUNT.format(total)}` }
}
