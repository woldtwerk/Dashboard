import { describe, expect, it } from 'vitest'
import { decisionInstructions, decisionPrompt, decisionSchema, toDecisionAnswers } from '../server/automation-ai/decide'
import type { DecisionQuestion } from '../../automation/shared/types/automation'

const questions: Record<string, DecisionQuestion> = {
  kind: {
    type: 'choice',
    instructions: 'What kind of mail is this?',
    options: { invoice: 'A bill to pay', receipt: 'Proof of a payment' }
  },
  urgent: { type: 'yesno', instructions: 'Is this urgent?' }
}

describe('decisionSchema', () => {
  it('offers the option keys for a choice and a boolean for a yes/no question', () => {
    const schema = decisionSchema(questions)

    expect(schema.safeParse({
      kind: { choice: 'invoice', confidence: 0.9 },
      urgent: { answer: true, confidence: 0.8 }
    }).success).toBe(true)

    expect(schema.safeParse({
      kind: { choice: 'newsletter', confidence: 0.9 },
      urgent: { answer: true, confidence: 0.8 }
    }).success).toBe(false)
  })

  it('rejects a confidence outside 0..1', () => {
    const schema = decisionSchema({ urgent: questions.urgent! })
    expect(schema.safeParse({ urgent: { answer: false, confidence: 1.5 } }).success).toBe(false)
  })
})

describe('decisionPrompt', () => {
  it('carries the item text, the instructions and every option description', () => {
    const { system, prompt } = decisionPrompt('From: a@b.test\nSubject: Invoice', questions)

    expect(system).toBe(decisionInstructions())
    expect(system).toContain('calibrated confidence')
    expect(prompt).toContain('From: a@b.test')
    expect(prompt).toContain('What kind of mail is this?')
    expect(prompt).toContain('invoice: A bill to pay')
    expect(prompt).toContain('Is this urgent?')
  })
})

describe('toDecisionAnswers', () => {
  it('maps a choice and a yes/no answer', () => {
    const answers = toDecisionAnswers({
      kind: { choice: 'invoice', confidence: 0.9 },
      urgent: { answer: true, confidence: 0.8 }
    }, questions)

    expect(answers).toEqual({
      kind: { choice: 'invoice', confidence: 0.9 },
      urgent: { yes: 0.8, confidence: 0.8 }
    })
  })

  it('turns a confident "no" into a low P(true)', () => {
    const answers = toDecisionAnswers({ urgent: { answer: false, confidence: 0.9 } }, { urgent: questions.urgent! })
    expect(answers.urgent!.yes).toBeCloseTo(0.1)
    expect(answers.urgent!.confidence).toBe(0.9)
  })

  it('leaves a missing answer out', () => {
    expect(toDecisionAnswers({}, questions)).toEqual({})
  })
})
