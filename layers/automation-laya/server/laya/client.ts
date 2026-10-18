import type { DecisionAnswer, DecisionQuestion } from '../../../automation/shared/types/automation'
import { fromLayaBatchResponse, fromLayaResponse, toLayaBatchBody, toLayaBody } from './mapping'
import type { LayaRequestOptions } from './mapping'

/**
 * HTTP client for `laya-serve` (the local Laya decision server).
 *
 * Endpoints verified against `laya/serve.py` of laya 0.4.11 (sdist from PyPI,
 * `pip download --no-binary :all: laya==0.4.11`), not from memory:
 *
 * - `POST /v1/systemone`
 *     body: `{ state, questions, model?, max_len?, head_max_len?, task?, lang?,
 *              lang_guess?, min_confidence? }`
 *     `questions` is an object of at most 64 questions; a `choice` takes
 *     `{ type, instructions, criteria: {label: null} }`, a yes/no takes
 *     `{ type: 'noul', instructions }` (criteria optional).
 *     returns: `{ model, answers, usage, routing? }` where an answer is
 *     `{ type: 'choice', choice, probabilities, confidence, answer_confidence }`
 *     or `{ type: 'noul', noul, confidence, answer_confidence }` (`noul` is P(true)).
 * - `POST /v1/systemone/batch`
 *     body: `{ states, questions, ...controls, batch_size?, min_confidence?, sort_by_length? }`
 *     `states` is at most 64 (the adapter chunks to this); all states share one question set.
 *     returns: `{ results: [<systemone response>], total_usage }`, one result per state, in order.
 * - `GET /health` — `{ status: 'ok', ... }`; the detail needs the bearer, liveness does not.
 *
 * Auth: when `LAYA_API_KEY` is set the server requires `Authorization: Bearer <key>`.
 * Overload: past `LAYA_MAX_CONCURRENT` the server answers `503` with `Retry-After: 1`.
 * Other errors: 400/413/422 for a bad request, 500 for a failed inference.
 */

export interface LayaClientOptions {
  /** Base URL, e.g. `http://laya:8000` */
  url: string
  /** Bearer token; empty when the server has no key set */
  apiKey?: string
  /** Per-request timeout in milliseconds */
  timeoutMs?: number
  /** States per batch request; laya-serve caps one request at 64 */
  batchSize?: number
  /** Forwarded controls (model, max_len, lang_guess) */
  request?: LayaRequestOptions
  /** Retries after a 503, honouring `Retry-After` */
  maxRetries?: number
  /** Injected for tests; defaults to the global fetch */
  fetch?: typeof fetch
}

export interface LayaClient {
  systemOne(state: string, questions: Record<string, DecisionQuestion>): Promise<Record<string, DecisionAnswer>>
  /** One answer set per state, in the order given; chunks to `batchSize` */
  systemOneBatch(states: string[], questions: Record<string, DecisionQuestion>): Promise<Array<Record<string, DecisionAnswer>>>
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_BATCH_SIZE = 64
const DEFAULT_MAX_RETRIES = 2

/** How long to wait after a 503 when the server sends no usable `Retry-After` */
const DEFAULT_RETRY_AFTER_MS = 1000

function retryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after')
  const seconds = header ? Number(header) : Number.NaN
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export function createLayaClient(options: LayaClientOptions): LayaClient {
  const base = options.url.replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const batchSize = Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, DEFAULT_BATCH_SIZE)
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const doFetch = options.fetch ?? fetch

  async function request(path: string, body: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (options.apiKey) {
      headers.authorization = `Bearer ${options.apiKey}`
    }

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      let response: Response
      try {
        response = await doFetch(`${base}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        })
      } finally {
        clearTimeout(timer)
      }

      // Overload is retryable; the server tells us when a slot is likely free
      if (response.status === 503 && attempt < maxRetries) {
        await sleep(retryAfterMs(response))
        continue
      }
      if (!response.ok) {
        throw new Error(`laya-serve answered ${response.status} for ${path}`)
      }
      return response
    }
  }

  async function systemOne(state: string, questions: Record<string, DecisionQuestion>): Promise<Record<string, DecisionAnswer>> {
    const response = await request('/v1/systemone', toLayaBody(state, questions, options.request))
    return fromLayaResponse(await response.json())
  }

  async function systemOneBatch(states: string[], questions: Record<string, DecisionQuestion>): Promise<Array<Record<string, DecisionAnswer>>> {
    if (!states.length) {
      return []
    }

    const answers: Array<Record<string, DecisionAnswer>> = []
    for (let start = 0; start < states.length; start += batchSize) {
      const chunk = states.slice(start, start + batchSize)
      const response = await request('/v1/systemone/batch', toLayaBatchBody(chunk, questions, options.request))
      answers.push(...fromLayaBatchResponse(await response.json()))
    }
    return answers
  }

  return { systemOne, systemOneBatch }
}
