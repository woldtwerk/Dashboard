import { z } from 'zod'
import type { DecisionAnswer, DecisionQuestion } from '../../../automation/shared/types/automation'

/**
 * Pure mapping between an automation decision and a language model call. Kept free
 * of Nuxt and provider code so the prompt and the answer mapping are testable.
 */

/** The shape one question's answer takes in the model's structured output */
export interface ChoiceDecisionOutput {
  choice: string
  confidence: number
}

export interface YesNoDecisionOutput {
  answer: boolean
  confidence: number
}

export type DecisionOutput = ChoiceDecisionOutput | YesNoDecisionOutput

/**
 * The structured output the model must produce: one entry per question, a choice
 * among the option keys or a boolean for a yes/no question, each with a calibrated
 * confidence. The option descriptions live in the prompt, not the schema.
 */
export function decisionSchema(questions: Record<string, DecisionQuestion>) {
  const shape: Record<string, z.ZodType> = {}

  for (const [id, question] of Object.entries(questions)) {
    if (question.type === 'choice') {
      const keys = Object.keys(question.options)
      shape[id] = z.object({
        choice: z.enum(keys.length ? keys as [string, ...string[]] : ['other']),
        confidence: z.number().min(0).max(1)
      })
    } else {
      shape[id] = z.object({
        answer: z.boolean(),
        confidence: z.number().min(0).max(1)
      })
    }
  }

  return z.object(shape)
}

/** The system instruction: answer each question, be calibrated, use the descriptions */
export function decisionInstructions(): string {
  return [
    'You classify one item for an automation rule.',
    'Answer every question. The option descriptions define what each choice means; pick the one that fits best.',
    'Report a calibrated confidence between 0 and 1 for the answer you gave:',
    '0.9 or more only when the item is unambiguous, around 0.5 when it could go either way.',
    'Never invent an option that was not offered.'
  ].join(' ')
}

/** The user prompt: the item's text and every question with its options */
export function decisionPrompt(state: string, questions: Record<string, DecisionQuestion>): { system: string, prompt: string } {
  const blocks = Object.entries(questions).map(([id, question]) => {
    if (question.type === 'choice') {
      const options = Object.entries(question.options)
        .map(([key, description]) => `  - ${key}: ${description}`)
        .join('\n')
      return `Question "${id}": ${question.instructions}\nChoices:\n${options}`
    }
    return `Question "${id}": ${question.instructions}\nAnswer true or false.`
  })

  return {
    system: decisionInstructions(),
    prompt: `Item:\n${state}\n\n${blocks.join('\n\n')}`
  }
}

/**
 * Maps the model's structured output onto the domain's answers. A yes/no answer
 * carries P(true), so a confident "no" is `yes: 1 - confidence`.
 */
export function toDecisionAnswers(
  output: Record<string, DecisionOutput>,
  questions: Record<string, DecisionQuestion>
): Record<string, DecisionAnswer> {
  const answers: Record<string, DecisionAnswer> = {}

  for (const [id, question] of Object.entries(questions)) {
    const entry = output[id]
    if (!entry) {
      continue
    }

    if (question.type === 'choice') {
      const choice = (entry as ChoiceDecisionOutput).choice
      answers[id] = { choice, confidence: entry.confidence }
    } else {
      const answer = (entry as YesNoDecisionOutput).answer
      answers[id] = { yes: answer ? entry.confidence : 1 - entry.confidence, confidence: entry.confidence }
    }
  }

  return answers
}
