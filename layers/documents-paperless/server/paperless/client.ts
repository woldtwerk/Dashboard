import { createError } from 'nuxt/server'

export interface PaperlessRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | boolean | undefined | null>
  json?: unknown
  /** Raw request body, e.g. a multipart upload streamed straight through */
  body?: BodyInit | null
  contentType?: string
  contentLength?: string
}

export interface PaperlessClient {
  readonly url: string
  request<T>(path: string, options?: PaperlessRequestOptions): Promise<T>
  /** A binary response (thumbnail, preview, download, archive) for the caller to stream */
  stream(path: string, options?: PaperlessRequestOptions): Promise<Response>
}

export interface PaperlessClientOptions {
  url: string
  token: string
  /** The stored service, when the client is built for one; enables error logging */
  serviceId?: string
}

/** Strips trailing slashes and refuses anything but http(s). */
function normalizeUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    throw createError({ status: 400, statusText: 'The Paperless-ngx URL is not valid' })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw createError({ status: 400, statusText: 'The Paperless-ngx URL must use http or https' })
  }
  return url.trim().replace(/\/+$/, '')
}

/** The instance's API version, from `X-Api-Version` on `/api/` (falling back to `/api/status/`). */
async function discoverVersion(url: string, token: string): Promise<number | null> {
  for (const probe of ['/api/', '/api/status/']) {
    try {
      const response = await fetch(`${url}${probe}`, {
        headers: { authorization: `Token ${token}`, accept: 'application/json' },
        redirect: 'manual'
      })
      const header = response.headers.get('x-api-version')
      if (header && /^\d+$/.test(header)) {
        return Number(header)
      }
    } catch {
      // Try the next probe
    }
  }
  return null
}

/** The first string anywhere in a nested error body, e.g. a field error message. */
function firstMessage(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = firstMessage(item)
      if (message) {
        return message
      }
    }
    return undefined
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const message = firstMessage(item)
      if (message) {
        return message
      }
    }
  }
  return undefined
}

async function errorMessage(response: Response): Promise<string> {
  const data = await response.json().catch(() => null)
  return firstMessage(data) ?? `Paperless-ngx returned ${response.status}`
}

/**
 * A thin Paperless-ngx REST client. Every path is a fixed `/api/...` the
 * provider builds from validated ids; the token never leaves the server.
 * The API version is discovered once per client from the running instance.
 */
export function createPaperlessClient(options: PaperlessClientOptions): PaperlessClient {
  const url = normalizeUrl(options.url)
  const token = options.token
  const logger = options.serviceId ? useServiceLogger('documents', options.serviceId) : undefined

  if (!token) {
    throw createError({ status: 400, statusText: 'A Paperless-ngx API token is required' })
  }

  let version: Promise<number | null> | undefined

  function accept(): Promise<string> {
    version ??= discoverVersion(url, token)
    return version.then(resolved => resolved === null ? 'application/json' : `application/json; version=${resolved}`)
  }

  function buildUrl(path: string, query?: PaperlessRequestOptions['query']): string {
    if (!path.startsWith('/api/')) {
      throw createError({ status: 500, statusText: 'Invalid Paperless-ngx path' })
    }
    const target = new URL(`${url}${path}`)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') {
        continue
      }
      target.searchParams.set(key, String(value))
    }
    return target.toString()
  }

  async function send(path: string, requestOptions: PaperlessRequestOptions): Promise<Response> {
    const headers = new Headers({ authorization: `Token ${token}`, accept: await accept() })
    let body = requestOptions.body ?? undefined

    if (requestOptions.json !== undefined) {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(requestOptions.json)
    } else if (requestOptions.contentType) {
      headers.set('content-type', requestOptions.contentType)
    }
    // Forward the original length of a streamed body, so the upstream can parse it
    if (requestOptions.contentLength && body instanceof ReadableStream) {
      headers.set('content-length', requestOptions.contentLength)
    }

    // A streamed body needs `duplex: half` in Node's fetch
    const init: RequestInit & { duplex?: 'half' } = {
      method: requestOptions.method ?? 'GET',
      headers,
      body
    }
    if (body instanceof ReadableStream) {
      init.duplex = 'half'
    }

    return await fetch(buildUrl(path, requestOptions.query), init)
  }

  return {
    url,

    async request<T>(path: string, requestOptions: PaperlessRequestOptions = {}): Promise<T> {
      const response = await send(path, requestOptions)
      if (!response.ok) {
        const message = await errorMessage(response)
        logger?.error('Paperless-ngx request failed', { path, status: response.status, error: message })
        throw createError({ status: response.status, statusText: message })
      }
      if (response.status === 204) {
        return undefined as T
      }
      return await response.json() as T
    },

    async stream(path: string, requestOptions: PaperlessRequestOptions = {}): Promise<Response> {
      const response = await send(path, requestOptions)
      if (!response.ok) {
        const message = await errorMessage(response)
        logger?.error('Paperless-ngx request failed', { path, status: response.status, error: message })
        throw createError({ status: response.status, statusText: message })
      }
      return response
    }
  }
}

export type PaperlessClientFactory = (options: PaperlessClientOptions) => PaperlessClient
