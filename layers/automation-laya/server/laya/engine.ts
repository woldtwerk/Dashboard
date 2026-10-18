import type { DecisionAnswer, DecisionQuestion } from '../../../automation/shared/types/automation'
import type { DecisionEngine } from '../../../automation/server/utils/decision-engine'
import type { LayaClient } from './client'

/** The automation decision port on top of the Laya HTTP client */
export function createLayaDecisionEngine(client: LayaClient): DecisionEngine {
  return {
    decide(state: string, questions: Record<string, DecisionQuestion>): Promise<Record<string, DecisionAnswer>> {
      return client.systemOne(state, questions)
    },
    decideBatch(states: string[], questions: Record<string, DecisionQuestion>): Promise<Array<Record<string, DecisionAnswer>>> {
      return client.systemOneBatch(states, questions)
    }
  }
}
