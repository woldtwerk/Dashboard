import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ImageSourceResult } from './image-sources'

/**
 * Originals are cached on disk so imgproxy's repeated reads of the same version
 * do not reach the domain again. The body and its sidecar are renamed into place
 * separately; a reader requires both, so a half-written entry is just a miss.
 * Every lease is shared (withLock), never process-local.
 */

const DEFAULT_DIR = '.cache/image-originals'
const DEFAULT_MAX_BYTES = 2 * 1024 ** 3
// A slow provider download of a large original can outlast a minute; a stale
// lease only costs a waiting request one duplicate load after WAIT_MAX_MS.
const LOAD_LOCK_TTL_MS = 10 * 60_000
const EVICT_LOCK_TTL_MS = 30_000
const EVICT_INTERVAL_MS = 60_000
const WAIT_MAX_MS = 20_000
const POLL_MS = 250
const ENTRY_PATTERN = /^([0-9a-f]{64})\.(bin|json)$/
const TEMP_PATTERN = /^[0-9a-f]{64}\.[0-9a-f-]+(?:\.json)?\.tmp$/

// Best-effort throttle hint for the write path only. Eviction itself never
// reads this, so it stays correct across workers and restarts.
let lastEvictionAttempt = 0

export interface OriginalCacheOptions {
  dir?: string
  maxBytes?: number
  /** test seams */
  waitMs?: number
  pollMs?: number
}

export interface CachedOriginal {
  result: ImageSourceResult
  status: 'hit' | 'miss'
}

interface Sidecar {
  contentType: string
  size: number
  storedAt: number
}

interface ResolvedOptions {
  dir: string
  maxBytes: number
  waitMs: number
  pollMs: number
}

export function originalCacheKey(source: string, id: string, version: string): string {
  return createHash('sha256').update(`${source}|${id}|${version}`).digest('hex')
}

function runtimeSettings(): { dir?: string, maxBytes?: number } {
  try {
    return useRuntimeConfig().imageOriginalCache ?? {}
  } catch {
    return {}
  }
}

function resolveOptions(options: OriginalCacheOptions): ResolvedOptions {
  // Tests pass both explicitly; reading the runtime config stays inside the
  // function so a config change is picked up without a module reload.
  const configured = options.dir !== undefined && options.maxBytes !== undefined
    ? {}
    : runtimeSettings()
  // An empty env value means "use the default", not the app root.
  const dir = options.dir || configured.dir || DEFAULT_DIR

  return {
    dir: resolve(process.cwd(), dir),
    maxBytes: options.maxBytes ?? configured.maxBytes ?? DEFAULT_MAX_BYTES,
    waitMs: options.waitMs ?? WAIT_MAX_MS,
    pollMs: options.pollMs ?? POLL_MS
  }
}

function debugCacheFailure(error: unknown): void {
  // No id or path: a file name may be personal data.
  useServiceLogger('image').debug('Could not cache an image original', { error: String(error) })
}

async function readSidecar(path: string): Promise<Sidecar | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<Sidecar>
    if (typeof parsed?.contentType !== 'string' || typeof parsed.size !== 'number' || typeof parsed.storedAt !== 'number') {
      return undefined
    }
    return parsed as Sidecar
  } catch {
    return undefined
  }
}

/** Both halves of an entry exist; no descriptor is opened for a mere check. */
async function cachedSidecar(hash: string, dir: string): Promise<Sidecar | undefined> {
  const sidecar = await readSidecar(join(dir, `${hash}.json`))
  if (!sidecar) {
    return undefined
  }
  try {
    const bodyStat = await stat(join(dir, `${hash}.bin`))
    if (!bodyStat.isFile()) {
      return undefined
    }
  } catch {
    return undefined
  }
  return sidecar
}

async function readCached(hash: string, dir: string): Promise<CachedOriginal | undefined> {
  const binPath = join(dir, `${hash}.bin`)
  const sidecar = await cachedSidecar(hash, dir)
  if (!sidecar) {
    return undefined
  }

  // Hold an open descriptor before handing out the stream: an eviction can
  // unlink the path afterwards without truncating bytes already being served.
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(binPath, 'r')
  } catch {
    // A missing body makes this a miss, not a 500.
    return undefined
  }

  try {
    const bodyStat = await handle.stat()
    if (!bodyStat.isFile()) {
      await handle.close()
      return undefined
    }

    // LRU: a served entry becomes the newest one for eviction.
    await utimes(binPath, new Date(), new Date()).catch(() => {})

    return {
      result: {
        body: Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>,
        contentType: sidecar.contentType,
        size: sidecar.size
      },
      status: 'hit'
    }
  } catch {
    await handle.close().catch(() => {})
    return undefined
  }
}

async function writeBody(body: ImageSourceResult['body'], tmp: string): Promise<void> {
  if (Buffer.isBuffer(body)) {
    await writeFile(tmp, body)
    return
  }
  await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmp))
}

async function fileSize(path: string, fallback?: number): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return fallback ?? 0
  }
}

function buffered(bytes: Buffer, contentType: string): ImageSourceResult {
  return { body: bytes, contentType, size: bytes.length }
}

/**
 * Writes both files under unique temp names and renames them into place. A
 * source stream error is the load's failure and is rethrown; filesystem errors
 * are best effort. Returns the body to serve: normally a stream from the file,
 * but the finished temp bytes when the entry could not be placed, because the
 * source stream has been consumed by then.
 */
async function storeOriginal(
  loaded: ImageSourceResult,
  hash: string,
  dir: string,
  options: OriginalCacheOptions
): Promise<ImageSourceResult> {
  const uuid = randomUUID()
  const bodyTmp = join(dir, `${hash}.${uuid}.tmp`)
  const sidecarTmp = join(dir, `${hash}.${uuid}.json.tmp`)
  const binPath = join(dir, `${hash}.bin`)
  const jsonPath = join(dir, `${hash}.json`)
  let sourceError: unknown
  let bodyRenamed = false
  let sidecarRenamed = false

  try {
    await mkdir(dir, { recursive: true })

    try {
      await writeBody(loaded.body, bodyTmp)
    } catch (error) {
      sourceError = error
      throw error
    }

    await writeFile(sidecarTmp, JSON.stringify({
      contentType: loaded.contentType,
      size: await fileSize(bodyTmp, loaded.size),
      storedAt: Date.now()
    } satisfies Sidecar))
    await rename(bodyTmp, binPath)
    bodyRenamed = true
    await rename(sidecarTmp, jsonPath)
    sidecarRenamed = true

    // At most one eviction attempt per worker per minute after a write. The
    // timestamp is only a hint; evictOriginals itself always runs when called.
    const now = Date.now()
    if (now - lastEvictionAttempt >= EVICT_INTERVAL_MS) {
      lastEvictionAttempt = now
      try {
        await evictOriginals({ ...options, keep: hash })
      } catch (error) {
        debugCacheFailure(error)
      }
    }

    const served = await readCached(hash, dir)
    if (served) {
      return served.result
    }
    const placed = await readFile(binPath).catch(() => undefined)
    return placed ? buffered(placed, loaded.contentType) : loaded
  } catch (error) {
    if (sourceError !== undefined) {
      throw sourceError
    }
    debugCacheFailure(error)
    // The source is spent; the temp (or the body already renamed into place)
    // still holds the real bytes, before `finally` removes those files.
    const written = await readFile(bodyRenamed ? binPath : bodyTmp).catch(() => undefined)
    return written ? buffered(written, loaded.contentType) : loaded
  } finally {
    await unlink(bodyTmp).catch(() => {})
    await unlink(sidecarTmp).catch(() => {})
    if (bodyRenamed && !sidecarRenamed) {
      await unlink(binPath).catch(() => {})
    }
  }
}

export async function hasCachedOriginal(
  source: string,
  id: string,
  version: string,
  options: OriginalCacheOptions = {}
): Promise<boolean> {
  // An unversioned id can change under the same key, so it is never cached.
  if (version === '') {
    return false
  }
  const hash = originalCacheKey(source, id, version)
  const { dir } = resolveOptions(options)
  return (await cachedSidecar(hash, dir)) !== undefined
}

export async function cachedOriginal(
  source: string,
  id: string,
  version: string,
  load: () => Promise<ImageSourceResult>,
  options: OriginalCacheOptions = {}
): Promise<CachedOriginal> {
  if (version === '') {
    return { result: await load(), status: 'miss' }
  }

  const hash = originalCacheKey(source, id, version)
  const { dir, waitMs, pollMs } = resolveOptions(options)

  const cached = await readCached(hash, dir)
  if (cached) {
    return cached
  }

  let acquired: CachedOriginal | undefined
  let innerFailed = false

  try {
    // The inner function always returns a CachedOriginal or throws, so an
    // `undefined` result unambiguously means another worker holds the lease.
    acquired = await withLock(`image-original-cache:${hash}`, LOAD_LOCK_TTL_MS, async () => {
      try {
        const existing = await readCached(hash, dir)
        if (existing) {
          return existing
        }

        const loaded = await load()
        return { result: await storeOriginal(loaded, hash, dir, options), status: 'miss' as const }
      } catch (error) {
        // A source failure must reach the route; only the lease is best effort.
        innerFailed = true
        throw error
      }
    })
  } catch (error) {
    if (innerFailed) {
      throw error
    }
    useServiceLogger('image').debug('Could not acquire the image original cache lease', { error: String(error) })
    return { result: await load(), status: 'miss' }
  }

  if (acquired) {
    return acquired
  }

  // Another worker holds the load lease: wait for its entry rather than
  // issuing a second provider call, then fall back to loading here.
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, pollMs))
    const appeared = await readCached(hash, dir)
    if (appeared) {
      return appeared
    }
  }

  return { result: await load(), status: 'miss' }
}

export async function evictOriginals(options: OriginalCacheOptions & { keep?: string } = {}): Promise<number> {
  const { dir, maxBytes } = resolveOptions(options)
  const keep = options.keep

  const deleted = await withLock('image-original-cache:evict', EVICT_LOCK_TTL_MS, async () => {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return 0
    }

    interface Entry {
      files: Array<{ name: string, size: number }>
      size: number
      ownMtime: number
      binMtime?: number
      jsonMtime?: number
    }
    const entries = new Map<string, Entry>()

    for (const name of names) {
      const pair = ENTRY_PATTERN.exec(name)
      const isTemp = !pair && TEMP_PATTERN.test(name)
      if (!pair && !isTemp) {
        // Foreign files are never ours to count or delete.
        continue
      }
      const key = pair?.[1] ?? name
      let entryStat
      try {
        entryStat = await stat(join(dir, name))
      } catch {
        continue
      }
      if (!entryStat.isFile()) {
        continue
      }

      // An unpaired .bin or .json is still an entry; a stale temp stands alone.
      let entry = entries.get(key)
      if (!entry) {
        entry = { files: [], size: 0, ownMtime: entryStat.mtimeMs }
        entries.set(key, entry)
      }
      entry.files.push({ name, size: entryStat.size })
      entry.size += entryStat.size
      if (pair?.[2] === 'bin') {
        entry.binMtime = entryStat.mtimeMs
      } else if (pair?.[2] === 'json') {
        entry.jsonMtime = entryStat.mtimeMs
      }
    }

    let total = [...entries.values()].reduce((sum, entry) => sum + entry.size, 0)
    if (total <= maxBytes) {
      return 0
    }

    const target = Math.floor(maxBytes * 0.9)
    const mtime = (entry: Entry) => entry.binMtime ?? entry.jsonMtime ?? entry.ownMtime
    const oldestFirst = [...entries.entries()]
      .filter(([key]) => key !== keep)
      .sort((a, b) => mtime(a[1]) - mtime(b[1]))

    let count = 0
    for (const [, entry] of oldestFirst) {
      if (total <= target) {
        break
      }
      for (const file of entry.files) {
        try {
          await unlink(join(dir, file.name))
          total -= file.size
        } catch {
          // Already gone
        }
      }
      count++
    }
    return count
  })

  return deleted ?? 0
}
