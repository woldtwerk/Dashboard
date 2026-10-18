import type { AutomationDomain, AutomationItem } from '../../shared/types/automation'
import type { AutomationLogger } from './engine'
import { errorMessage } from './engine'

/** What one sweep tick loaded, and how far the cursor may advance */
export interface SweepTick {
  items: AutomationItem[]
  /** The newest timestamp among the loaded items, or the old cursor when the load was empty */
  cursor: string | null
}

/** Everything the sweep needs; the runtime builds it from providers and the cache DB */
export interface SweepDeps {
  services(domain: AutomationDomain): Promise<string[]>
  cursor(domain: AutomationDomain, service: string): Promise<string | null>
  setCursor(domain: AutomationDomain, service: string, cursor: string): Promise<void>
  load(domain: AutomationDomain, service: string, since: string | null, limit: number): Promise<SweepTick>
  /** Feeds the items to the same evaluation the domain events use */
  evaluate(domain: AutomationDomain, service: string, items: AutomationItem[]): Promise<unknown>
  withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined>
  logger?: AutomationLogger
}

/** Most items one sweep tick examines per service */
export const SWEEP_LIMIT = 200
/** A tick is one page per service; the lease covers it with room to spare */
export const SWEEP_LOCK_TTL_MS = 4 * 60_000
/** Documents are swept first: a missed ingest is the case this safety net exists for */
export const SWEEP_DOMAINS: AutomationDomain[] = ['documents', 'mail']

export interface SweepServiceResult {
  /** Items fed to the evaluation */
  swept: number
  /** True when another worker or the previous tick still holds the lease */
  skipped: boolean
}

/**
 * One (domain, service) tick, on at most one cluster worker at a time. Items the
 * evaluation already handled (or gave up on) are filtered out by the evaluator
 * itself, so a re-swept window is harmless.
 */
export async function sweepService(domain: AutomationDomain, service: string, deps: SweepDeps): Promise<SweepServiceResult> {
  const result = await deps.withLock(`automation-sweep:${domain}:${service}`, SWEEP_LOCK_TTL_MS, async () => {
    const since = await deps.cursor(domain, service)
    const { items, cursor } = await deps.load(domain, service, since, SWEEP_LIMIT)

    if (!items.length) {
      return 0
    }

    await deps.evaluate(domain, service, items)

    // Advance only after the evaluation; a crash before this re-reads the window
    if (cursor && cursor !== since) {
      await deps.setCursor(domain, service, cursor)
    }

    return items.length
  })

  return { swept: result ?? 0, skipped: result === undefined }
}

/** Every configured service of every swept domain; one failure never stops the rest */
export async function sweepAll(deps: SweepDeps): Promise<Record<AutomationDomain, number>> {
  const totals: Record<AutomationDomain, number> = { mail: 0, documents: 0 }

  for (const domain of SWEEP_DOMAINS) {
    let services: string[]
    try {
      services = await deps.services(domain)
    } catch (error) {
      deps.logger?.warn?.('Could not list services for the automation sweep', { domain, error: errorMessage(error) })
      continue
    }

    for (const service of services) {
      try {
        const { swept } = await sweepService(domain, service, deps)
        totals[domain] += swept
      } catch (error) {
        deps.logger?.warn?.('Automation sweep failed', { domain, service, error: errorMessage(error) })
      }
    }
  }

  return totals
}
