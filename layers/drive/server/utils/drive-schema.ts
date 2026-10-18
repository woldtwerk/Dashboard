import { z } from 'zod'
import { splitPath } from '../../shared/drive-path'

/** Whether a string holds a C0/C1 control character, which a path must not. */
export function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

/** A name is a single path segment: no backslash (the escape), no traversal. */
export function validDriveName(name: string): boolean {
  return name.length > 0
    && name.length <= 255
    && name !== '.' && name !== '..'
    && !name.includes('\\')
    && !hasControlChars(name)
}

/** A path is absolute, has no control characters and no `.`/`..` segment. */
export function validDrivePath(path: string): boolean {
  if (!path.startsWith('/') || path.length > 4096 || hasControlChars(path)) {
    return false
  }
  return !splitPath(path).some(segment => segment === '.' || segment === '..')
}

export const driveNameSchema = z.string().refine(validDriveName, 'Enter a valid file name')
export const drivePathSchema = z.string().refine(validDrivePath, 'The path is invalid')
export const drivePathsSchema = z.array(drivePathSchema).min(1).max(100)

export const driveServiceQuerySchema = z.object({
  service: z.string().min(1)
})

export const drivePathQuerySchema = driveServiceQuerySchema.extend({
  path: drivePathSchema
})

/** `path` may repeat, so a single entry and a selection both download. */
export const driveDownloadQuerySchema = driveServiceQuerySchema.extend({
  path: z.preprocess(value => Array.isArray(value) ? value : [value], drivePathsSchema),
  /** `inline=1` renders the file in the browser instead of downloading it */
  inline: z.stringbool().optional(),
  /** Version of the entry (`<modified>-<size>`), so an inline preview can be cached */
  v: z.string().min(1).max(512).optional()
})

export const driveFolderBodySchema = z.object({
  service: z.string().min(1),
  path: drivePathSchema,
  name: driveNameSchema
})

export const driveRenameBodySchema = z.object({
  service: z.string().min(1),
  path: drivePathSchema,
  name: driveNameSchema
})

export const driveMoveBodySchema = z.object({
  service: z.string().min(1),
  paths: drivePathsSchema,
  target: drivePathSchema
})

export const driveCopyBodySchema = z.object({
  service: z.string().min(1),
  paths: drivePathsSchema,
  target: drivePathSchema,
  name: driveNameSchema.optional()
})

export const drivePathsBodySchema = z.object({
  service: z.string().min(1),
  paths: drivePathsSchema
})

export const driveEmptyTrashBodySchema = z.object({
  service: z.string().min(1)
})

export const driveShareBodySchema = z.object({
  service: z.string().min(1),
  path: drivePathSchema,
  role: z.string().max(64).optional(),
  password: z.string().max(256).optional(),
  expiration: z.string().max(64).optional()
})

export const driveShareQuerySchema = driveServiceQuerySchema.extend({
  path: drivePathSchema
})

export const driveInvitationBodySchema = z.object({
  service: z.string().min(1),
  accept: z.boolean()
})
