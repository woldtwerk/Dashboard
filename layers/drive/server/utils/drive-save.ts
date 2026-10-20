import type { DriveEntry, DriveSkippedFile } from '../../shared/types/drive'
import type { DriveNameConflict } from '../../shared/drive-upload'
import { folderSteps, sanitizeDriveFileName, sha256Hex, uniqueDriveName } from '../../shared/drive-upload'
import { joinPath } from '../../shared/drive-path'
import { affectedPaths, invalidateDriveListings } from './drive-cache'
import { publishDriveChange } from './drive-events'
import { hasSavedFile, recordSavedFile } from './drive-files'

/** A file the drive sink uploads */
export interface DriveSaveFile {
  name: string
  contentType: string
  content: Uint8Array
}

/** A file handed to the drive, already decoded or still streamed */
export interface DriveSaveUpload {
  name: string
  contentType: string
  content?: Uint8Array
  stream?: ReadableStream<Uint8Array>
}

/** The drive operations a save needs; the runtime builds it from the provider */
export interface DriveSavePort {
  /** Creates every missing folder below the section root (`mkdir -p`) */
  ensureFolder(service: string, path: string): Promise<void>
  /** The entries directly inside a folder, for the conflict check */
  list(service: string, path: string): Promise<Array<Pick<DriveEntry, 'name' | 'type' | 'size'>>>
  /** Uploads one file; the port invalidates the listing and announces the change */
  upload(service: string, folder: string, file: DriveSaveFile): Promise<void>
}

/** The content records of saved files, so the same bytes are saved only once */
export interface DriveFileHistory {
  /** Whether the same bytes were already saved into this folder */
  has(service: string, folder: string, sha256: string): Promise<boolean>
  /** Records an upload; `false` means another worker recorded the same bytes first */
  record(file: { service: string, folder: string, sha256: string, path: string, size: number }): Promise<boolean>
}

/** A file handed to {@link saveFilesToDrive} */
export interface DriveSaveInput {
  filename: string
  contentType: string
  /** The decoded size, used when the content arrives as a stream */
  size?: number
  content?: Uint8Array
  stream?: ReadableStream<Uint8Array>
}

export interface DriveSaveResult {
  saved: string[]
  skipped: DriveSkippedFile[]
}

export interface DriveSaveOptions {
  conflict?: DriveNameConflict
  checkDuplicates?: boolean
  /** Called before every upload, e.g. to renew an automation lock */
  onBeforeUpload?: () => Promise<void> | void
}

export interface DriveSaveDeps {
  drive?: DriveSavePort
  history?: DriveFileHistory
  onBeforeUpload?: () => Promise<void> | void
}

/** The live drive provider, with the cache invalidation and events the API also does. */
export function createDriveSavePort(): DriveSavePort {
  return {
    async ensureFolder(service, path) {
      const provider = await useDriveProvider(service)

      for (const step of folderSteps(path)) {
        const entries = await provider.list(step.parent)
        if (entries.some(entry => entry.type === 'folder' && entry.name === step.name)) {
          continue
        }

        await provider.createFolder(step.parent, step.name)
        await invalidateDriveListings(service, affectedPaths('folder', { path: step.parent }))
        await publishDriveChange(service, step.parent)
      }
    },

    async list(service, path) {
      const provider = await useDriveProvider(service)
      return (await provider.list(path)).map(entry => ({ name: entry.name, type: entry.type, size: entry.size }))
    },

    async upload(service, folder, file) {
      const provider = await useDriveProvider(service)
      const body = await uploadBody(file.name, file.contentType, file.content)

      await provider.upload(folder, {
        stream: bytesStream(body.body),
        contentType: body.contentType,
        contentLength: body.contentLength
      })

      await invalidateDriveListings(service, affectedPaths('upload', { path: folder }))
      await publishDriveChange(service, folder)
    }
  }
}

/** The multipart body of an upload, buffered so its exact length is known */
export interface DriveSaveUploadBody {
  body: Uint8Array
  contentType: string
  contentLength: string
}

/**
 * The multipart body the provider streams into the drive. A stream sent without
 * a length goes chunked, which the drive rejects, so the body is buffered and
 * measured; the file's content is already in memory, so this costs no extra.
 */
export async function uploadBody(name: string, contentType: string, content: Uint8Array): Promise<DriveSaveUploadBody> {
  const form = new FormData()
  // Copy into a fresh view, so the Blob sees an ArrayBuffer rather than ArrayBufferLike
  form.append('file', new Blob([new Uint8Array(content)], { type: contentType }), name)
  const response = new Response(form)
  const body = new Uint8Array(await response.arrayBuffer())

  return {
    body,
    contentType: response.headers.get('content-type') ?? contentType,
    contentLength: String(body.byteLength)
  }
}

/** Delivers buffered bytes to the provider as the one-chunk stream it expects */
function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  })
}

/** Reads a web stream into memory; an upload needs the bytes for its multipart body. */
async function readStream(stream: ReadableStream<Uint8Array> | undefined): Promise<Uint8Array> {
  if (!stream) {
    return new Uint8Array()
  }
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Creates every missing folder below the section root. */
export async function ensureDriveFolder(service: string, path: string, drive = createDriveSavePort()): Promise<void> {
  await drive.ensureFolder(service, path)
}

/** Uploads one file, invalidating the listing and publishing the change. */
export async function uploadDriveFile(
  service: string,
  folder: string,
  file: DriveSaveUpload,
  drive = createDriveSavePort()
): Promise<void> {
  const content = file.content ?? await readStream(file.stream)
  await drive.upload(service, folder, { name: file.name, contentType: file.contentType, content })
}

/**
 * Saves files into a drive folder. With the duplicate check on (the default) a
 * file whose bytes were already saved into the folder is skipped, whatever its
 * name, so the same video arriving in several mails is stored once, and a file
 * already there by name and size is skipped too — that catches files put there
 * by hand. With it off, both skips are gone: the same bytes are stored again and
 * a same-name file is renamed or skipped as the conflict rule asks. The content
 * record is written either way, so turning the check back on later knows the
 * file. `onBeforeUpload` runs before every upload, which is where an automation
 * run renews its lock.
 */
export async function saveFilesToDrive(
  service: string,
  folder: string,
  files: DriveSaveInput[],
  options: DriveSaveOptions = {},
  deps: DriveSaveDeps = {}
): Promise<DriveSaveResult> {
  const drive = deps.drive ?? createDriveSavePort()
  const history = deps.history ?? { has: hasSavedFile, record: recordSavedFile }
  const conflict: DriveNameConflict = options.conflict ?? 'rename'
  const checkDuplicates = options.checkDuplicates !== false
  const onBeforeUpload = options.onBeforeUpload ?? deps.onBeforeUpload

  await drive.ensureFolder(service, folder)
  const existing = (await drive.list(service, folder))
    .filter(entry => entry.type === 'file')
    .map(entry => ({ name: entry.name, size: entry.size ?? 0 }))

  const result: DriveSaveResult = { saved: [], skipped: [] }

  for (const [index, file] of files.entries()) {
    const content = file.content ?? await readStream(file.stream)
    const size = content.byteLength
    const sha256 = await sha256Hex(content)
    const filename = sanitizeDriveFileName(file.filename, file.contentType, index)

    // The same bytes under another name are the same file; do not store them twice
    if (checkDuplicates && await history.has(service, folder, sha256)) {
      result.skipped.push({ name: filename, reason: 'duplicate' })
      continue
    }

    const name = uniqueDriveName(existing, filename, size, conflict, checkDuplicates)
    if (!name) {
      const sameSize = existing.some(entry => entry.name === filename && entry.size === size)
      result.skipped.push({ name: filename, reason: checkDuplicates && sameSize ? 'duplicate' : 'exists' })
      continue
    }

    await onBeforeUpload?.()
    await drive.upload(service, folder, { name, contentType: file.contentType, content })
    existing.push({ name, size })

    // Insert right after each upload: a later failure keeps what already succeeded
    await history.record({ service, folder, sha256, path: joinPath(folder, name), size })
    result.saved.push(joinPath(folder, name))
  }

  return result
}
