import { z } from 'zod'
import type { DecisionAnswer, DecisionQuestion } from '../../../automation/shared/types/automation'

/**
 * Pure mappers between the automation domain's questions/answers and the Laya
 * `/v1/systemone` wire format. Verified against `laya/serve.py` of laya 0.4.11
 * (see `client.ts` for the endpoints); the JSON below mirrors that code's
 * `questions` schema and answer types, so the fixtures in the tests are real.
 */

/** One question as Laya accepts it */
export type LayaQuestion
  = | { type: 'choice', instructions: string, criteria: Record<string, null> }
    | { type: 'noul', instructions: string }

export interface LayaRequestOptions {
  /** A Laya checkpoint name; omitted lets the router choose (LAYA_DEFAULT_MODEL) */
  model?: string
  /** Per-state token budget; the server caps it at LAYA_MAX_TOKEN_BUDGET */
  maxLen?: number
  /**
   * A `lang_guess` hint. Laya routes by the state's content when it is absent
   * (the multilingual checkpoint is preloaded), so the adapter leaves it out
   * unless the deployment sets one.
   */
  lang?: string
}

// --- Request --------------------------------------------------------------

/** Domain questions to Laya's `questions` object; option keys become choice labels */
export function toLayaQuestions(questions: Record<string, DecisionQuestion>): Record<string, LayaQuestion> {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    if (question.type === 'choice') {
      // Laya reads a choice's `criteria` as a label -> description map; `null` is fine
      return [id, {
        type: 'choice',
        instructions: question.instructions,
        criteria: Object.fromEntries(Object.keys(question.options).map(option => [option, null]))
      } satisfies LayaQuestion]
    }
    return [id, { type: 'noul', instructions: question.instructions } satisfies LayaQuestion]
  }))
}

function controlFields(options: LayaRequestOptions): Record<string, unknown> {
  const controls: Record<string, unknown> = {}
  if (options.model) {
    controls.model = options.model
  }
  if (options.maxLen !== undefined) {
    controls.max_len = options.maxLen
  }
  if (options.lang) {
    controls.lang_guess = options.lang
  }
  return controls
}

/** The body of `POST /v1/systemone` */
export function toLayaBody(state: string, questions: Record<string, DecisionQuestion>, options: LayaRequestOptions = {}): Record<string, unknown> {
  return { state, questions: toLayaQuestions(questions), ...controlFields(options) }
}

/** The body of `POST /v1/systemone/batch`; the caller chunks to at most 64 states */
export function toLayaBatchBody(states: string[], questions: Record<string, DecisionQuestion>, options: LayaRequestOptions = {}): Record<string, unknown> {
  return { states, questions: toLayaQuestions(questions), ...controlFields(options) }
}

// --- Response -------------------------------------------------------------

const choiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: z.number().optional(),
  answer_confidence: z.number().optional(),
  /** Laya reports the option probabilities for a choice; mapped to `scores` */
  probabilities: z.record(z.string(), z.number()).optional()
})

const noulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number(),
  confidence: z.number().optional(),
  answer_confidence: z.number().optional()
})

// A score answer is not asked by a rule, but must not break the mapping
const scoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number(),
  confidence: z.number().optional(),
  answer_confidence: z.number().optional()
})

const answerSchema = z.discriminatedUnion('type', [choiceAnswerSchema, noulAnswerSchema, scoreAnswerSchema])

const systemOneResponseSchema = z.object({
  answers: z.record(z.string(), answerSchema)
})

const batchResponseSchema = z.object({
  results: z.array(systemOneResponseSchema)
})

/**
 * Laya's calibrated `answer_confidence`, falling back to its normalized-entropy
 * `confidence`. The plan's threshold semantics are Jev's, which the calibrated
 * value matches; `confidence` alone would answer a different number.
 */
function answerConfidence(answer: { confidence?: number, answer_confidence?: number }): number {
  return answer.answer_confidence ?? answer.confidence ?? 0
}

/** Maps one answer of Laya's `answers` object onto the domain's answer */
export function fromLayaAnswer(answer: z.infer<typeof answerSchema>): DecisionAnswer {
  if (answer.type === 'choice') {
    return { choice: answer.choice, confidence: answerConfidence(answer), scores: answer.probabilities }
  }
  if (answer.type === 'noul') {
    // Laya sends no per-option probabilities for a yes/no answer, only P(true)
    return { yes: answer.noul, confidence: answerConfidence(answer) }
  }
  // A score answer has no yes/choice; keep only its confidence so the caller sees it
  return { confidence: answerConfidence(answer) }
}

/** Maps a `POST /v1/systemone` response body onto the domain's answers */
export function fromLayaResponse(payload: unknown): Record<string, DecisionAnswer> {
  const parsed = systemOneResponseSchema.parse(payload)
  return Object.fromEntries(Object.entries(parsed.answers).map(([id, answer]) => [id, fromLayaAnswer(answer)]))
}

/** Maps a `POST /v1/systemone/batch` response body, one answer set per state, in order */
export function fromLayaBatchResponse(payload: unknown): Array<Record<string, DecisionAnswer>> {
  const parsed = batchResponseSchema.parse(payload)
  return parsed.results.map(result => fromLayaResponse(result))
}
