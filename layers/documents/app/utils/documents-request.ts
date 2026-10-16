/**
 * Calls the documents API with the browser's fetch. Nuxt's `$fetch` types every
 * route, and with this many routes that inference hits TypeScript's depth limit,
 * so the UI uses a plain fetch instead.
 */
export interface DocumentsRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | boolean | string[] | undefined | null>
  body?: unknown
  /** Send the body as-is (e.g. a FormData upload) instead of JSON */
  raw?: boolean
}

export async function documentsRequest<T>(path: string, options: DocumentsRequestOptions = {}): Promise<T> {
  const url = new URL(path, 'http://localhost')
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null) {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item))
      }
    } else {
      url.searchParams.set(key, String(value))
    }
  }

  const raw = options.raw ?? options.body instanceof FormData
  const response = await fetch(`${url.pathname}${url.search}`, {
    method: options.method ?? 'GET',
    headers: options.body !== undefined && !raw ? { 'content-type': 'application/json' } : undefined,
    body: options.body === undefined ? undefined : raw ? options.body as BodyInit : JSON.stringify(options.body)
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { statusMessage?: string, message?: string }
    throw new Error(data.statusMessage || data.message || 'The documents request failed')
  }

  return await response.json() as T
}

/** The URL of a proxied file (thumbnail, preview, download); the token stays server side. */
export function documentsFileUrl(
  kind: 'thumb' | 'preview' | 'download',
  service: string,
  id: number,
  options: { original?: boolean } = {}
): string {
  const params = new URLSearchParams({ service })
  if (kind === 'download' && options.original) {
    params.set('original', '1')
  }
  return `/api/documents/${id}/${kind}?${params.toString()}`
}
