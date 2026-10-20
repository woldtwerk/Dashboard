import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveFileHistory, DriveSavePort } from '../server/utils/drive-save'
import { createDriveSavePort, saveFilesToDrive, uploadBody } from '../server/utils/drive-save'
import { sha256Hex } from '../shared/drive-upload'

vi.mock('../server/utils/drive-cache', () => ({
  affectedPaths: vi.fn(() => ['/my-files/Public/salsa']),
  invalidateDriveListings: vi.fn()
}))

vi.mock('../server/utils/drive-events', () => ({
  publishDriveChange: vi.fn()
}))

const encoder = new TextEncoder()

function file(filename: string, contentType: string, body: string) {
  return { filename, contentType, content: encoder.encode(body) }
}

function fakeDrive(initial: Array<{ name: string, size: number }> = []) {
  const entries: Array<{ name: string, type: 'file' | 'folder', size?: number }> = initial.map(entry => ({ ...entry, type: 'file' }))
  const ensured: string[] = []
  const uploaded: Array<{ folder: string, name: string, contentType: string, body: string }> = []

  const drive: DriveSavePort = {
    async ensureFolder(_service, path) {
      ensured.push(path)
    },
    async list() {
      return entries.map(entry => ({ ...entry }))
    },
    async upload(_service, folder, saved) {
      uploaded.push({ folder, name: saved.name, contentType: saved.contentType, body: new TextDecoder().decode(saved.content) })
      entries.push({ name: saved.name, type: 'file', size: saved.content.byteLength })
    }
  }

  return { drive, ensured, uploaded, entries }
}

function fakeHistory(preloaded: Array<{ service: string, folder: string, sha256: string, path: string, size: number }> = []) {
  const rows = new Map(preloaded.map(row => [`${row.service}:${row.folder}:${row.sha256}`, row]))
  const recorded: Array<{ service: string, folder: string, sha256: string, path: string, size: number }> = []

  const history: DriveFileHistory = {
    async has(service, folder, sha256) {
      return rows.has(`${service}:${folder}:${sha256}`)
    },
    async record(row) {
      const key = `${row.service}:${row.folder}:${row.sha256}`
      if (rows.has(key)) {
        return false
      }
      rows.set(key, row)
      recorded.push(row)
      return true
    }
  }

  return { history, recorded }
}

describe('uploadBody', () => {
  it('measures the multipart body it returns', async () => {
    const { body, contentType, contentLength } = await uploadBody('clip.mp4', 'video/mp4', encoder.encode('video'))
    const boundary = contentType.match(/boundary=(.+)$/)?.[1]

    // A body sent without its length goes chunked, which the drive rejects
    expect(contentLength).toBe(String(body.byteLength))
    expect(boundary).toBeTruthy()
    expect(new TextDecoder().decode(body)).toContain(`--${boundary}`)
  })
})

describe('createDriveSavePort', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploads into the folder, not into a path named after the file', async () => {
    const upload = vi.fn(async (_path: string, _upload: unknown) => {})
    vi.stubGlobal('useDriveProvider', () => Promise.resolve({ upload }))

    await createDriveSavePort().upload('drive-1', '/my-files/Public/salsa', {
      name: 'clip.mp4',
      contentType: 'video/mp4',
      content: encoder.encode('video')
    })

    expect(upload).toHaveBeenCalledTimes(1)
    // The provider takes the target folder; the file name travels in the multipart body
    expect(upload.mock.calls[0]?.[0]).toBe('/my-files/Public/salsa')
  })
})

describe('saveFilesToDrive', () => {
  it('uploads an accepted file and records its content', async () => {
    const { drive, ensured, uploaded } = fakeDrive()
    const { history, recorded } = fakeHistory()

    const result = await saveFilesToDrive('drive-1', '/my-files/Public', [
      file('clip.mp4', 'video/mp4', 'video')
    ], {}, { drive, history })

    expect(ensured).toEqual(['/my-files/Public'])
    expect(uploaded).toEqual([{ folder: '/my-files/Public', name: 'clip.mp4', contentType: 'video/mp4', body: 'video' }])
    expect(result.saved).toEqual(['/my-files/Public/clip.mp4'])
    expect(result.skipped).toEqual([])
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ service: 'drive-1', folder: '/my-files/Public', path: '/my-files/Public/clip.mp4', size: 5 })
  })

  it('skips the same bytes under another name', async () => {
    const { drive, uploaded } = fakeDrive()
    const content = file('new-name.mp4', 'video/mp4', 'known video')
    const sha256 = await sha256Hex(content.content)
    const { history } = fakeHistory([
      { service: 'drive-1', folder: '/my-files/Public', sha256, path: '/my-files/Public/old-name.mp4', size: content.content.byteLength }
    ])

    const result = await saveFilesToDrive('drive-1', '/my-files/Public', [content], {}, { drive, history })

    expect(uploaded).toEqual([])
    expect(result).toEqual({ saved: [], skipped: [{ name: 'new-name.mp4', reason: 'duplicate' }] })
  })

  it('skips a same-name file of the same size as a duplicate', async () => {
    const { drive, uploaded } = fakeDrive([{ name: 'clip.mp4', size: 5 }])

    const result = await saveFilesToDrive('drive-1', '/my-files/Public', [file('clip.mp4', 'video/mp4', 'video')], {}, { drive, history: fakeHistory().history })

    expect(uploaded).toEqual([])
    expect(result.skipped).toEqual([{ name: 'clip.mp4', reason: 'duplicate' }])
  })

  it('renames a same-name file of another size', async () => {
    const { drive, uploaded } = fakeDrive([{ name: 'clip.mp4', size: 1 }])

    const result = await saveFilesToDrive('drive-1', '/my-files/Public', [file('clip.mp4', 'video/mp4', 'video')], {}, { drive, history: fakeHistory().history })

    expect(uploaded.map(entry => entry.name)).toEqual(['clip (1).mp4'])
    expect(result.saved).toEqual(['/my-files/Public/clip (1).mp4'])
  })

  it('skips a name conflict when the action says skip', async () => {
    const { drive, uploaded } = fakeDrive([{ name: 'clip.mp4', size: 1 }])

    const result = await saveFilesToDrive('drive-1', '/my-files/Public', [file('clip.mp4', 'video/mp4', 'video')], { conflict: 'skip' }, { drive, history: fakeHistory().history })

    expect(uploaded).toEqual([])
    expect(result.skipped).toEqual([{ name: 'clip.mp4', reason: 'exists' }])
  })

  it('renames the second of two attachments that share a name', async () => {
    const { drive, uploaded } = fakeDrive()

    const result = await saveFilesToDrive('drive-1', '/my-files/Public', [
      file('photo.jpg', 'image/jpeg', 'first'),
      file('photo.jpg', 'image/jpeg', 'second!')
    ], {}, { drive, history: fakeHistory().history })

    expect(uploaded.map(entry => entry.name)).toEqual(['photo.jpg', 'photo (1).jpg'])
    expect(result.saved).toEqual(['/my-files/Public/photo.jpg', '/my-files/Public/photo (1).jpg'])
  })

  it('saves the same content again when the duplicate check is off', async () => {
    const { drive, uploaded } = fakeDrive()
    const content = file('new-name.mp4', 'video/mp4', 'known video')
    const sha256 = await sha256Hex(content.content)
    const { history, recorded } = fakeHistory([
      { service: 'drive-1', folder: '/my-files/Public', sha256, path: '/my-files/Public/old-name.mp4', size: content.content.byteLength }
    ])

    const result = await saveFilesToDrive('drive-1', '/my-files/Public', [content], { checkDuplicates: false }, { drive, history })

    expect(uploaded.map(entry => entry.name)).toEqual(['new-name.mp4'])
    expect(result.saved).toEqual(['/my-files/Public/new-name.mp4'])
    // The row is already there, and the lost race is not an error
    expect(recorded).toEqual([])
  })

  it('runs onBeforeUpload before every upload', async () => {
    const { drive, uploaded } = fakeDrive()
    const renew = vi.fn(async () => {})

    await saveFilesToDrive('drive-1', '/my-files/Public', [
      file('a.mp4', 'video/mp4', 'a'),
      file('b.mp4', 'video/mp4', 'b')
    ], { onBeforeUpload: renew }, { drive, history: fakeHistory().history })

    expect(renew).toHaveBeenCalledTimes(uploaded.length)
  })
})
