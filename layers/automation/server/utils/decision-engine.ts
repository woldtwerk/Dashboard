import { createError } from 'nuxt/server'
import type { DecisionAnswer, DecisionQuestion } from '../../shared/types/automation'

/**
 * Port every decision engine implements. The engine answers typed questions about
 * a piece of text and reports its calibrated confidence. `decideBatch` answers the
 * same questions for several states (e.g. Laya collates them into one forward pass).
 */
export interface DecisionEngine {
  decide(state: string, questions: Record<string, DecisionQuestion>): Promise<Record<string, DecisionAnswer>>
  decideBatch(states: string[], questions: Record<string, DecisionQuestion>): Promise<Array<Record<string, DecisionAnswer>>>
}

/** Creates an engine from configuration; call from a Nitro plugin */
export type DecisionEngineFactory = () => DecisionEngine

const engines = new Map<string, DecisionEngineFactory>()

export function registerDecisionEngine(id: string, create: DecisionEngineFactory): void {
  engines.set(id, create)
}

export function hasDecisionEngine(): boolean {
  return engines.size > 0
}

/** The registered engine, or the first registered one when no id is given */
export function useDecisionEngine(id?: string): DecisionEngine {
  const factory = id ? engines.get(id) : firstEngine()
  if (!factory) {
    throw createError({ status: 503, statusText: 'No decision engine is configured' })
  }
  return factory()
}

function firstEngine(): DecisionEngineFactory | undefined {
  for (const factory of engines.values()) {
    return factory
  }
  return undefined
}
