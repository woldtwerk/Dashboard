import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { normalizeDriveFolderInput } from '../../../shared/drive-path'
import { getFileSource } from '../../../../core/server/utils/file-sources'
import { saveFilesToDrive } from '../../utils/drive-save'

const driveImportBodySchema = z.object({
  source: z.string().min(1).max(100),
  ref: z.string().min(1).max(4000),
  parts: z.array(z.string().regex(/^\d+(\.\d+)*$/, 'Invalid attachment part')).min(1).max(50),
  service: z.string().min(1),
  folder: z.string().min(1).max(2000),
  conflict: z.enum(['rename', 'skip']).optional(),
  checkDuplicates: z.boolean().default(true)
})

function reasonOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const { statusMessage, message } = error as { statusMessage?: string, message?: string }
    return statusMessage || message || 'Unknown error'
  }
  return String(error ?? 'Unknown error')
}

/**
 * Imports files another domain serves (e.g. mail attachments) into a drive
 * folder. Each part is pulled through the file-source registry and streamed into
 * the drive sink; a failing part does not discard the files already saved.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, driveImportBodySchema)

  const folder = normalizeDriveFolderInput(body.folder)
  if (!folder) {
    throw createError({ status: 400, statusText: 'Invalid drive folder' })
  }

  const source = getFileSource(body.source)
  if (!source) {
    throw createError({ status: 404, statusText: `File source "${body.source}" is not available` })
  }

  const saved: string[] = []
  const skipped: Array<{ name: string, reason: 'duplicate' | 'exists' }> = []
  const failed: Array<{ part: string, reason: string }> = []

  for (const part of [...new Set(body.parts)]) {
    let opened
    try {
      opened = await source.open(body.ref, part)
      if (!opened) {
        throw new Error('Attachment part not found')
      }

      const result = await saveFilesToDrive(body.service, folder, [{
        filename: opened.meta.filename,
        contentType: opened.meta.contentType,
        size: opened.meta.size,
        stream: opened.stream
      }], {
        conflict: body.conflict,
        checkDuplicates: body.checkDuplicates
      })

      saved.push(...result.saved)
      skipped.push(...result.skipped)
    } catch (error) {
      failed.push({ part, reason: reasonOf(error) })
    } finally {
      await opened?.close()
    }
  }

  return { saved, skipped, failed }
})
