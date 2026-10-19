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
 *     `{ type, instructions, criteria: {label: "description"} }` (the value is the
 *     description the model reads), a yes/no takes
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
  /** Timeout for one `/v1/systemone` call */
  singleTimeoutMs?: number
  /**
   * Timeout for one `/v1/systemone/batch` call. Batch calls carry many states and
   * the first call after a cold start also warms the model, so they get longer.
   */
  batchTimeoutMs?: number
  /** States per batch request; laya-serve caps one request at 64 */
  batchSize?: number
  /** Forwarded controls (model, max_len, lang_guess) */
  request?: LayaRequestOptions
  /** Retries after a 503, honouring `Retry-After` */
  maxRetries?: number
  /** Retries after a timeout/abort (the model can be cold or busy) */
  maxAbortRetries?: number
  /** Injected for tests; defaults to the global fetch */
  fetch?: typeof fetch
}

export interface LayaClient {
  systemOne(state: string, questions: Record<string, DecisionQuestion>): Promise<Record<string, DecisionAnswer>>
  /** One answer set per state, in the order given; chunks to `batchSize` */
  systemOneBatch(states: string[], questions: Record<string, DecisionQuestion>): Promise<Array<Record<string, DecisionAnswer>>>
}

const DEFAULT_SINGLE_TIMEOUT_MS = 30_000
const DEFAULT_BATCH_TIMEOUT_MS = 60_000
const DEFAULT_BATCH_SIZE = 64
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_MAX_ABORT_RETRIES = 1

/** How long to wait after a 503 when the server sends no usable `Retry-After` */
const DEFAULT_RETRY_AFTER_MS = 1000

function retryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after')
  const seconds = header ? Number(header) : Number.NaN
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS
}

/** Whether a fetch rejection is our own timeout/abort rather than a server error */
function isAbort(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return error.name === 'AbortError' || error.name === 'TimeoutError' || /aborted|timeout/i.test(error.message)
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export function createLayaClient(options: LayaClientOptions): LayaClient {
  const base = options.url.replace(/\/+$/, '')
  const singleTimeoutMs = options.singleTimeoutMs ?? DEFAULT_SINGLE_TIMEOUT_MS
  const batchTimeoutMs = options.batchTimeoutMs ?? DEFAULT_BATCH_TIMEOUT_MS
  const batchSize = Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, DEFAULT_BATCH_SIZE)
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const maxAbortRetries = options.maxAbortRetries ?? DEFAULT_MAX_ABORT_RETRIES
  const doFetch = options.fetch ?? fetch

  async function request(path: string, body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (options.apiKey) {
      headers.authorization = `Bearer ${options.apiKey}`
    }

    let overloadRetries = 0
    let abortRetries = 0

    for (;;) {
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
      } catch (error) {
        // The first call after a cold start loads the model and can overrun the
        // deadline; one retry is worth it before the item is counted as failed.
        if (isAbort(error) && abortRetries < maxAbortRetries) {
          abortRetries++
          await sleep(500)
          continue
        }
        throw error
      } finally {
        clearTimeout(timer)
      }

      // Overload is retryable; the server tells us when a slot is likely free
      if (response.status === 503 && overloadRetries < maxRetries) {
        overloadRetries++
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
    const response = await request('/v1/systemone', toLayaBody(state, questions, options.request), singleTimeoutMs)
    return fromLayaResponse(await response.json())
  }

  async function systemOneBatch(states: string[], questions: Record<string, DecisionQuestion>): Promise<Array<Record<string, DecisionAnswer>>> {
    if (!states.length) {
      return []
    }

    const answers: Array<Record<string, DecisionAnswer>> = []
    for (let start = 0; start < states.length; start += batchSize) {
      const chunk = states.slice(start, start + batchSize)
      const response = await request('/v1/systemone/batch', toLayaBatchBody(chunk, questions, options.request), batchTimeoutMs)
      answers.push(...fromLayaBatchResponse(await response.json()))
    }
    return answers
  }

  return { systemOne, systemOneBatch }
}
