/**
 * Calls the drive API with the browser's fetch. Nuxt's `$fetch` types every
 * route, and with this many routes that inference hits TypeScript's depth limit,
 * so the explorer uses a plain fetch instead.
 */
export interface DriveRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  query?: Record<string, string | string[] | undefined>
  body?: unknown
  /** Return the response as text instead of JSON */
  text?: boolean
}

export async function driveRequest<T>(path: string, options: DriveRequestOptions = {}): Promise<T> {
  const url = new URL(path, 'http://localhost')
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item)
      }
    } else {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetch(`${url.pathname}${url.search}`, {
    method: options.method ?? 'GET',
    headers: options.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { statusMessage?: string, message?: string }
    throw new Error(data.statusMessage || data.message || 'The drive request failed')
  }

  return (options.text ? await response.text() : await response.json()) as T
}
