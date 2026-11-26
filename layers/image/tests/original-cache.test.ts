import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageSourceResult } from '../server/utils/image-sources'
import {
  cachedOriginal,
  evictOriginals,
  hasCachedOriginal,
  originalCacheKey
} from '../server/utils/original-cache'

const SOURCE = 'drive'
const ID = 'a/personal file.png'
const VERSION = 'v1'

let dir: string
let held: Set<string>

function streamResult(text: string): ImageSourceResult {
  const bytes = new Uint8Array(Buffer.from(text))
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      }
    }),
    contentType: 'image/png'
  }
}

const names = async (): Promise<string[]> => (await readdir(dir)).sort()
const options = (): { dir: string, maxBytes: number } => ({ dir, maxBytes: 1024 * 1024 })

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'image-original-cache-'))

  vi.stubGlobal('useServiceLogger', () => ({ debug: () => {}, warn: () => {}, error: () => {}, info: () => {} }))

  // Emulates the database lease: a second concurrent holder is turned away
  held = new Set<string>()
  vi.stubGlobal('withLock', (name: string, _ttl: number, fn: (handle: { renew: () => Promise<boolean> }) => Promise<unknown>) => {
    if (held.has(name)) {
      return Promise.resolve(undefined)
    }
    held.add(name)
    return Promise.resolve(fn({ renew: async () => true })).finally(() => held.delete(name))
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(dir, { recursive: true, force: true })
})

describe('cachedOriginal', () => {
  it.each([
    ['a web stream', () => streamResult('payload')],
    ['a Buffer', () => ({ body: Buffer.from('payload'), contentType: 'image/png' })]
  ])('stores and serves a miss from %s', async (_label, produce) => {
    const load = vi.fn(async () => produce())
    const cached = await cachedOriginal(SOURCE, ID, VERSION, load, options())

    expect(load).toHaveBeenCalledTimes(1)
    expect(cached.status).toBe('miss')
    expect(await new Response(cached.result.body as BodyInit).text()).toBe('payload')

    const hash = originalCacheKey(SOURCE, ID, VERSION)
    expect(await names()).toEqual([`${hash}.bin`, `${hash}.json`])
    expect(await hasCachedOriginal(SOURCE, ID, VERSION, options())).toBe(true)

    const sidecar = JSON.parse(await readFile(join(dir, `${hash}.json`), 'utf8')) as { contentType: string, size: number }
    expect(sidecar.contentType).toBe('image/png')
    expect(sidecar.size).toBe(7)
  })

  it('serves a second request from disk without loading again', async () => {
    await cachedOriginal(SOURCE, ID, VERSION, async () => streamResult('original'), options())

    const load = vi.fn(async () => streamResult('replacement'))
    const cached = await cachedOriginal(SOURCE, ID, VERSION, load, options())

    expect(load).not.toHaveBeenCalled()
    expect(cached.status).toBe('hit')
    expect(await new Response(cached.result.body as BodyInit).text()).toBe('original')
  })

  it('treats a body without its sidecar as a miss and repairs it', async () => {
    const hash = originalCacheKey(SOURCE, ID, VERSION)
    await writeFile(join(dir, `${hash}.bin`), 'stale')

    const load = vi.fn(async () => streamResult('repaired'))
    const cached = await cachedOriginal(SOURCE, ID, VERSION, load, options())

    expect(load).toHaveBeenCalledTimes(1)
    expect(cached.status).toBe('miss')
    expect(await new Response(cached.result.body as BodyInit).text()).toBe('repaired')
    expect(await names()).toEqual([`${hash}.bin`, `${hash}.json`])
  })

  it('serves the real bytes when the sidecar cannot be placed', async () => {
    const hash = originalCacheKey(SOURCE, ID, VERSION)
    await mkdir(join(dir, `${hash}.json`))

    const cached = await cachedOriginal(SOURCE, ID, VERSION, async () => streamResult('still real'), options())

    expect(cached.status).toBe('miss')
    expect(await new Response(cached.result.body as BodyInit).text()).toBe('still real')
    expect(await names()).toEqual([`${hash}.json`])

    await rm(join(dir, `${hash}.json`), { recursive: true })
    expect(await names()).toEqual([])
  })

  it('never touches disk without a version', async () => {
    const load = vi.fn(async () => streamResult('unversioned'))
    const first = await cachedOriginal(SOURCE, ID, '', load, options())
    const second = await cachedOriginal(SOURCE, ID, '', load, options())

    expect(first.status).toBe('miss')
    expect(second.status).toBe('miss')
    expect(load).toHaveBeenCalledTimes(2)
    expect(await hasCachedOriginal(SOURCE, ID, '', options())).toBe(false)
    expect(await names()).toEqual([])
  })

  it('leaves no files when the load rejects', async () => {
    const load = vi.fn(async (): Promise<ImageSourceResult> => {
      throw new Error('provider down')
    })
    await expect(cachedOriginal(SOURCE, ID, VERSION, load, options())).rejects.toThrow('provider down')
    expect(await names()).toEqual([])
  })

  it('removes a partial temp when the source stream errors', async () => {
    const failing: ImageSourceResult = {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(Buffer.from('partial')))
          controller.error(new Error('stream broke'))
        }
      }),
      contentType: 'image/png'
    }

    await expect(cachedOriginal(SOURCE, ID, VERSION, async () => failing, options())).rejects.toThrow('stream broke')
    expect(await names()).toEqual([])
  })

  it('waits for another worker\'s entry instead of loading again', async () => {
    const hash = originalCacheKey(SOURCE, ID, VERSION)
    held.add(`image-original-cache:${hash}`)

    // The other worker writes only after this request has been turned away by
    // the lease, so the entry has to be found by the polling loop.
    const delayed = setTimeout(() => {
      void (async () => {
        await writeFile(join(dir, `${hash}.bin`), 'shared')
        await writeFile(join(dir, `${hash}.json`), JSON.stringify({
          contentType: 'image/png',
          size: 6,
          storedAt: Date.now()
        }))
      })().catch(() => {})
    }, 20)

    const load = vi.fn(async () => streamResult('local'))
    try {
      const cached = await cachedOriginal(SOURCE, ID, VERSION, load, { ...options(), pollMs: 5, waitMs: 500 })

      expect(load).not.toHaveBeenCalled()
      expect(cached.status).toBe('hit')
      expect(await new Response(cached.result.body as BodyInit).text()).toBe('shared')
    } finally {
      clearTimeout(delayed)
    }
  })

  it('loads directly when the other worker never writes', async () => {
    held.add(`image-original-cache:${originalCacheKey(SOURCE, ID, VERSION)}`)

    const load = vi.fn(async () => streamResult('fallback'))
    const cached = await cachedOriginal(SOURCE, ID, VERSION, load, { ...options(), pollMs: 1, waitMs: 20 })

    expect(load).toHaveBeenCalledTimes(1)
    expect(cached.status).toBe('miss')
    expect(await new Response(cached.result.body as BodyInit).text()).toBe('fallback')
    expect(await names()).toEqual([])
  })
})

describe('evictOriginals', () => {
  it('deletes the oldest pairs down to 90 % of the budget and leaves foreign files alone', async () => {
    const hashes = Array.from({ length: 6 }, (_, index) => `${'a'.repeat(63)}${(index + 1).toString(16)}`)
    const base = Date.now() - 60_000

    for (const [index, hash] of hashes.entries()) {
      const at = new Date(base + index * 1000)
      await writeFile(join(dir, `${hash}.bin`), 'x'.repeat(200))
      await writeFile(join(dir, `${hash}.json`), '{}')
      await utimes(join(dir, `${hash}.bin`), at, at)
      await utimes(join(dir, `${hash}.json`), at, at)
    }
    await writeFile(join(dir, 'keep-me.txt'), 'foreign')

    expect(await evictOriginals({ dir, maxBytes: 10_000 })).toBe(0)
    expect(await evictOriginals({ dir, maxBytes: 1000 })).toBe(2)

    const remaining = await names()
    expect(remaining).toContain('keep-me.txt')
    expect(remaining).not.toContain(`${hashes[0]}.bin`)
    expect(remaining).not.toContain(`${hashes[1]}.bin`)
    expect(remaining).toContain(`${hashes[5]}.bin`)
    expect(remaining).toContain(`${hashes[5]}.json`)
  })

  it('removes a stale temp file but leaves foreign files untouched', async () => {
    const hash = 'b'.repeat(64)
    await writeFile(join(dir, `${hash}.bin`), 'x'.repeat(200))
    await writeFile(join(dir, `${hash}.json`), '{}')
    const tempName = `${hash}.12345678-1234-1234-1234-123456789abc.tmp`
    await writeFile(join(dir, tempName), 'y'.repeat(500))
    const sidecarTempName = `${hash}.87654321-1234-1234-1234-123456789abc.json.tmp`
    await writeFile(join(dir, sidecarTempName), 'z'.repeat(200))
    const old = new Date(Date.now() - 120_000)
    await utimes(join(dir, tempName), old, old)
    await utimes(join(dir, sidecarTempName), old, old)
    await writeFile(join(dir, 'keep-me.txt'), 'foreign')

    expect(await evictOriginals({ dir, maxBytes: 300 })).toBe(2)
    expect(await names()).toEqual([`${hash}.bin`, `${hash}.json`, 'keep-me.txt'])
  })
})
