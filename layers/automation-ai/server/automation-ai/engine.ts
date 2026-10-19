import { generateText, Output } from 'ai'
import { parseModelParam } from '../../../ai/shared/ai-model'
import { FallbackUnavailableError } from '../../../automation/shared/workflow'
import type { DecisionEngine } from '../../../automation/server/utils/decision-engine'
import type { DecisionAnswer, DecisionFallback } from '../../../automation/shared/types/automation'
import type { DecisionOutput } from './decide'
import { decisionPrompt, decisionSchema, toDecisionAnswers } from './decide'

/**
 * A fallback engine that asks the configured AI provider. The model is the entry's
 * `serviceId:modelId`, or the first AI service's default model when it is empty.
 * States are answered one after another, so a wave of items does not fire dozens of
 * requests at once.
 */
export function createAiDecisionEngine(fallback: Extract<DecisionFallback, { type: 'ai' }>): DecisionEngine {
  async function decideBatch(
    states: string[],
    questions: Parameters<DecisionEngine['decideBatch']>[1]
  ): Promise<Array<Record<string, DecisionAnswer>>> {
    const services = await listServices('ai')
    if (!services.length) {
      throw new FallbackUnavailableError('No AI service is set up')
    }

    const selection = parseModelParam(fallback.model)
    const { model, headers } = await useAiModel(selection
      ? { service: selection.serviceId, model: selection.modelId }
      : {})

    const answers: Array<Record<string, DecisionAnswer>> = []
    for (const state of states) {
      const result = await generateText({
        model,
        headers,
        ...decisionPrompt(state, questions),
        output: Output.object({ schema: decisionSchema(questions) })
      })
      answers.push(toDecisionAnswers(result.output as unknown as Record<string, DecisionOutput>, questions))
    }
    return answers
  }

  return {
    decide: async (state, questions) => (await decideBatch([state], questions))[0] ?? {},
    decideBatch
  }
}
