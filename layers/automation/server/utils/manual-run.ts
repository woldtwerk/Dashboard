import type { AutomationItem, WorkflowRunItemResult } from '../../shared/types/automation'

/** The lease could not be renewed; this worker must not touch the batch any more */
export const MANUAL_RUN_LOST_LOCK = 'lost the run lock'

/**
 * A manual run can walk 100 items with Laya and AI fallbacks one after another.
 * The lease is renewed before every group and item; this TTL only has to cover the
 * longest single operation between two renewals (one batched walk).
 */
export const MANUAL_RUN_LOCK_TTL_MS = 30 * 60_000

/** One loaded item together with the ref the request addressed it by */
export interface ManualRunEntry {
  ref: string
  item: AutomationItem
}

/** The selected items of one service, in request order */
export interface ManualRunGroup {
  service: string
  entries: ManualRunEntry[]
}

/** One group per service, in the order the request first names that service */
export function groupByService(entries: ManualRunEntry[]): ManualRunGroup[] {
  const groups = new Map<string, ManualRunEntry[]>()

  for (const entry of entries) {
    const group = groups.get(entry.item.service)
    if (group) {
      group.push(entry)
    } else {
      groups.set(entry.item.service, [entry])
    }
  }

  return [...groups].map(([service, groupEntries]) => ({ service, entries: groupEntries }))
}

/** The per-item results of a batch whose lease is gone */
export function lostLockResults(entries: ManualRunEntry[]): WorkflowRunItemResult[] {
  return entries.map(entry => ({ ref: entry.ref, outcome: 'failed', error: MANUAL_RUN_LOST_LOCK }))
}

export interface ManualRunGroupsDeps {
  /** Renews the run's lease; false means another worker owns it now */
  renew: () => Promise<boolean>
  /**
   * Runs one service group with its own dependencies. `beforeItem` must be awaited
   * before each item and stops the group when it returns false.
   */
  runGroup: (group: ManualRunGroup, beforeItem: () => Promise<boolean>) => Promise<WorkflowRunItemResult[]>
}

/**
 * Runs the loaded items group by group, renewing the lease before every group and
 * — through `beforeItem` — before every item. Once a renewal fails, that group's
 * remaining items and every later group are reported failed instead of being
 * applied by a worker that no longer holds the lease.
 */
export async function runManualGroups(
  entries: ManualRunEntry[],
  deps: ManualRunGroupsDeps
): Promise<WorkflowRunItemResult[]> {
  const byRef = new Map<string, WorkflowRunItemResult>()
  let lost = false

  for (const group of groupByService(entries)) {
    if (lost || !(await deps.renew())) {
      lost = true
      for (const result of lostLockResults(group.entries)) {
        byRef.set(result.ref, result)
      }
      continue
    }

    const results = await deps.runGroup(group, async () => {
      if (lost) {
        return false
      }
      if (!(await deps.renew())) {
        lost = true
        return false
      }
      return true
    })

    group.entries.forEach((entry, index) => {
      const result = results[index]
      if (result) {
        byRef.set(entry.ref, result)
      }
    })
  }

  return entries.map(entry => byRef.get(entry.ref) ?? {
    ref: entry.ref,
    outcome: 'failed',
    error: MANUAL_RUN_LOST_LOCK
  })
}
