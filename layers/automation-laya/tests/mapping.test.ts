import { describe, expect, it } from 'vitest'
import {
  fromLayaBatchResponse,
  fromLayaResponse,
  toLayaBatchBody,
  toLayaBody,
  toLayaQuestions
} from '../server/laya/mapping'
import type { DecisionQuestion } from '../../automation/shared/types/automation'

const questions: Record<string, DecisionQuestion> = {
  kind: {
    type: 'choice',
    instructions: 'What kind of mail is this?',
    options: { invoice: 'An invoice', other: 'Anything else' }
  },
  urgent: { type: 'yesno', instructions: 'Is this urgent?' }
}

// Shape taken from laya 0.4.11 `laya/serve.py` and `tests/test_serve.py` FULL_ANSWERS
const systemOneFixture = {
  model: 'laya-rl-agent',
  answers: {
    kind: {
      type: 'choice',
      choice: 'invoice',
      probabilities: { invoice: 0.9519, other: 0.0481 },
      confidence: 0.797,
      answer_confidence: 0.9519,
      action: { act_probability: 1.0 }
    },
    urgent: {
      type: 'noul',
      noul: 0.9148,
      confidence: 0.9148,
      answer_confidence: 0.88
    }
  },
  usage: { input_tokens: 42, output_tokens: 0 },
  routing: { model: 'multilingual', reason: 'German Latin text' }
}

describe('toLayaQuestions', () => {
  it('sends every option with its description as criteria', () => {
    expect(toLayaQuestions(questions)).toEqual({
      kind: {
        type: 'choice',
        instructions: 'What kind of mail is this?',
        criteria: { invoice: 'An invoice', other: 'Anything else' }
      },
      urgent: { type: 'noul', instructions: 'Is this urgent?' }
    })
  })

  it('keeps every option of a template choice, including the catch-all', () => {
    const templateQuestion: DecisionQuestion = {
      type: 'choice',
      instructions: 'invoice, receipt or anything else?',
      options: {
        invoice: 'A bill or invoice asking for payment',
        receipt: 'An order or payment confirmation',
        other: 'Anything else: personal mail, newsletters, notifications'
      }
    }

    const criteria = toLayaQuestions({ kind: templateQuestion }).kind
    expect(criteria).toMatchObject({
      criteria: {
        invoice: 'A bill or invoice asking for payment',
        receipt: 'An order or payment confirmation',
        other: 'Anything else: personal mail, newsletters, notifications'
      }
    })
  })

  it('falls back to the option key when a description is empty', () => {
    const mapped = toLayaQuestions({ kind: { type: 'choice', instructions: 'x', options: { invoice: '' } } })
    expect(mapped).toMatchObject({ kind: { criteria: { invoice: 'invoice' } } })
  })
})

describe('toLayaBody', () => {
  it('sends the state, questions and controls in the verified field names', () => {
    expect(toLayaBody('the mail', questions, { maxLen: 2048, model: 'multilingual', lang: 'de' })).toEqual({
      state: 'the mail',
      questions: toLayaQuestions(questions),
      max_len: 2048,
      model: 'multilingual',
      lang_guess: 'de'
    })
  })

  it('omits controls that were not given', () => {
    expect(toLayaBody('x', { urgent: questions.urgent! })).toEqual({
      state: 'x',
      questions: { urgent: { type: 'noul', instructions: 'Is this urgent?' } }
    })
  })

  it('builds the batch body with states', () => {
    expect(toLayaBatchBody(['a', 'b'], questions)).toMatchObject({ states: ['a', 'b'] })
  })
})

describe('fromLayaResponse', () => {
  it('maps choice and noul answers, preferring answer_confidence and keeping the probabilities', () => {
    expect(fromLayaResponse(systemOneFixture)).toEqual({
      kind: { choice: 'invoice', confidence: 0.9519, scores: { invoice: 0.9519, other: 0.0481 } },
      urgent: { yes: 0.9148, confidence: 0.88 }
    })
  })

  it('falls back to confidence when answer_confidence is absent', () => {
    const payload = {
      answers: { urgent: { type: 'noul', noul: 0.5, confidence: 0.42 } }
    }
    expect(fromLayaResponse(payload)).toEqual({ urgent: { yes: 0.5, confidence: 0.42 } })
  })

  it('keeps a score answer from breaking the mapping', () => {
    const payload = {
      answers: { urgency: { type: 'score', score: 1.6, confidence: 0.19, answer_confidence: 0.65 } }
    }
    expect(fromLayaResponse(payload)).toEqual({ urgency: { confidence: 0.65 } })
  })

  it('rejects a malformed response', () => {
    expect(() => fromLayaResponse({ answers: { kind: { type: 'choice' } } })).toThrow()
  })
})

describe('fromLayaBatchResponse', () => {
  it('maps one answer set per result, in order', () => {
    const payload = { results: [systemOneFixture, systemOneFixture], total_usage: { input_tokens: 84, output_tokens: 0 } }
    expect(fromLayaBatchResponse(payload)).toEqual([
      { kind: { choice: 'invoice', confidence: 0.9519, scores: { invoice: 0.9519, other: 0.0481 } }, urgent: { yes: 0.9148, confidence: 0.88 } },
      { kind: { choice: 'invoice', confidence: 0.9519, scores: { invoice: 0.9519, other: 0.0481 } }, urgent: { yes: 0.9148, confidence: 0.88 } }
    ])
  })
})
