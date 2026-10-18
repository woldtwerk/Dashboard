import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_DOCUMENTS_FILTERS } from '../../documents/shared/types/documents'
import { createPaperlessProvider } from '../server/paperless/provider'
import type { PaperlessDocumentDto, PaperlessTaskDto } from '../server/paperless/mapping'

const documentDto: PaperlessDocumentDto = {
  id: 1,
  title: 'Rechnung 2026',
  created: '2026-03-15',
  added: '2026-10-16T19:07:08Z',
  modified: '2026-10-16T19:07:08Z',
  correspondent: null,
  document_type: null,
  storage_path: null,
  tags: [1],
  archive_serial_number: null,
  original_file_name: 'test.pdf',
  archived_file_name: 'archived.pdf',
  mime_type: 'application/pdf',
  page_count: 1,
  owner: null
}

const taskDto: PaperlessTaskDto = {
  id: 4,
  task_id: 'task-123',
  task_type: 'consume_file',
  status: 'success',
  related_document_ids: [1],
  acknowledged: false,
  date_created: '2026-10-16T19:07:06Z'
}

interface Call { url: string, init: RequestInit }

function setupFetch(): Call[] {
  const calls: Call[] = []
  const json = (data: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', ...headers }
  })

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init: init ?? {} })

    if (url.endsWith('/api/')) {
      return json({ version: '10' }, { 'x-api-version': '10' })
    }
    if (url.includes('/api/documents/?')) {
      return json({ count: 1, next: null, previous: null, results: [documentDto] })
    }
    if (url.includes('/api/tasks/')) {
      return json({ count: 1, next: null, previous: null, results: [taskDto] })
    }
    if (url.endsWith('/api/documents/post_document/')) {
      return json('task-123')
    }
    return json({})
  })

  vi.stubGlobal('fetch', fetchMock)
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createPaperlessProvider', () => {
  it('builds the upstream query, sends the token and version, and maps the page', async () => {
    const calls = setupFetch()
    const provider = createPaperlessProvider({ url: 'http://paperless:8000', token: 'secret' })

    const page = await provider.list({
      page: 1,
      pageSize: 25,
      sort: 'added',
      order: 'desc',
      filters: { ...structuredClone(EMPTY_DOCUMENTS_FILTERS), tags: [1], inbox: true }
    })

    expect(page.results[0]!.title).toBe('Rechnung 2026')

    const listCall = calls.find(call => call.url.includes('/api/documents/?'))!
    expect(listCall.url).toContain('ordering=-added')
    expect(listCall.url).toContain('tags__id__in=1')
    expect(listCall.url).toContain('is_in_inbox=true')

    const headers = new Headers(listCall.init.headers)
    expect(headers.get('authorization')).toBe('Token secret')
    expect(headers.get('accept')).toBe('application/json; version=10')
  })

  it('uploads with the request content type and returns the task id', async () => {
    const calls = setupFetch()
    const provider = createPaperlessProvider({ url: 'http://paperless:8000', token: 'secret' })

    const taskId = await provider.upload({ stream: null, contentType: 'multipart/form-data; boundary=x' })
    expect(taskId).toBe('task-123')

    const uploadCall = calls.find(call => call.url.endsWith('/api/documents/post_document/'))!
    expect(uploadCall.init.method).toBe('POST')
    expect(new Headers(uploadCall.init.headers).get('content-type')).toBe('multipart/form-data; boundary=x')
  })

  it('polls a task by id', async () => {
    const calls = setupFetch()
    const provider = createPaperlessProvider({ url: 'http://paperless:8000', token: 'secret' })

    const task = await provider.task('task-123')
    expect(task.status).toBe('success')
    expect(calls.some(call => call.url.includes('task_id=task-123'))).toBe(true)
  })

  it('counts inbox and added documents with a one-item page', async () => {
    const calls = setupFetch()
    const provider = createPaperlessProvider({ url: 'http://paperless:8000', token: 'secret' })

    expect(await provider.countInbox()).toBe(1)
    expect(await provider.countAdded('2026-10-05', '2026-10-12')).toBe(1)

    const inbox = calls.find(call => call.url.includes('is_in_inbox=true'))!
    expect(inbox.url).toContain('page_size=1')

    const added = calls.find(call => call.url.includes('added__date__gte=2026-10-05'))!
    expect(added.url).toContain('added__date__lt=2026-10-12')
    expect(added.url).toContain('page_size=1')
  })

  it('pings the API root', async () => {
    const calls = setupFetch()
    const provider = createPaperlessProvider({ url: 'http://paperless:8000', token: 'secret' })

    await expect(provider.ping()).resolves.toBeUndefined()
    expect(calls.some(call => call.url.endsWith('/api/'))).toBe(true)
  })
})
