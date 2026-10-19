import { z } from 'zod'
import type { DomainTool, ToolSource } from '../../core/shared/types/tools'
import { entityLink } from '../../core/shared/entities'
import type { DriveEntry } from '../shared/types/drive'
import { driveNameSchema, drivePathSchema } from './utils/drive-schema'
import { publishDriveChange, publishDriveChanges, publishDriveTrashChange } from './utils/drive-events'

const serviceInput = z.string().min(1).describe('Drive service id')
const pathInput = drivePathSchema.describe('Absolute path, e.g. "/my-files/Photos"')
const nameInput = driveNameSchema.describe('A single file or folder name, without slashes')
const pathsInput = z.array(drivePathSchema).min(1).max(100).describe('Absolute paths of the entries')

function driveSource(entry: DriveEntry, service: string): ToolSource {
  const subtitle = entry.parent || entry.mediaType

  return {
    kind: entry.type === 'folder' ? 'folder' : 'file',
    title: entry.name,
    ...(subtitle ? { subtitle } : {}),
    ...(entry.modified ? { date: entry.modified } : {}),
    link: entityLink({ type: 'file', service, id: entry.path })
  }
}

/** Source cards for `drive_list`: one row per entry in the folder. */
export function driveListSources(output: unknown): ToolSource[] {
  const result = output as { service?: string, entries?: DriveEntry[] } | undefined
  if (!Array.isArray(result?.entries)) {
    return []
  }

  return result.entries.map(entry => driveSource(entry, result.service ?? ''))
}

/** Source card for `drive_info`: the one file or folder that was read. */
export function driveInfoSources(output: unknown): ToolSource[] {
  const entry = output as (Partial<DriveEntry> & { service?: string }) | undefined
  return entry?.path ? [driveSource(entry as DriveEntry, entry.service ?? '')] : []
}

export const driveTools: DomainTool[] = [
  {
    name: 'drive_list',
    domain: 'drive',
    description: 'List the files and folders directly inside a path, with name, type, size and modification date.',
    input: z.object({ service: serviceInput, path: pathInput }),
    writes: false,
    execute: async (raw) => {
      const input = raw as { service: string, path: string }
      return { service: input.service, entries: await (await useDriveProvider(input.service)).list(input.path) }
    },
    sources: driveListSources
  },
  {
    name: 'drive_info',
    domain: 'drive',
    description: 'Read one file or folder: its name, type, size, media type and modification date.',
    input: z.object({ service: serviceInput, path: pathInput }),
    writes: false,
    execute: async (raw) => {
      const input = raw as { service: string, path: string }
      return { ...await (await useDriveProvider(input.service)).info(input.path), service: input.service }
    },
    sources: driveInfoSources
  },
  {
    name: 'drive_create_folder',
    domain: 'drive',
    description: 'Create a folder inside an existing folder path.',
    input: z.object({
      service: serviceInput,
      path: pathInput.describe('Existing parent folder the new folder goes into'),
      name: nameInput
    }),
    writes: true,
    execute: async (raw) => {
      const input = raw as { service: string, path: string, name: string }
      await (await useDriveProvider(input.service)).createFolder(input.path, input.name)
      await publishDriveChange(input.service, input.path)

      return { ok: true, path: `${input.path.replace(/\/+$/, '')}/${input.name}` }
    }
  },
  {
    name: 'drive_move',
    domain: 'drive',
    description: 'Move one or more files or folders into a target folder.',
    input: z.object({
      service: serviceInput,
      paths: pathsInput.describe('Entries to move'),
      target: pathInput.describe('Destination folder path')
    }),
    writes: true,
    execute: async (raw) => {
      const input = raw as { service: string, paths: string[], target: string }
      await (await useDriveProvider(input.service)).move(input.paths, input.target)
      await publishDriveChanges(input.service, input.paths)
      await publishDriveChange(input.service, input.target)

      return { ok: true, moved: input.paths.length, target: input.target }
    }
  },
  {
    name: 'drive_rename',
    domain: 'drive',
    description: 'Rename one file or folder in place.',
    input: z.object({ service: serviceInput, path: pathInput, name: nameInput.describe('New name') }),
    writes: true,
    execute: async (raw) => {
      const input = raw as { service: string, path: string, name: string }
      await (await useDriveProvider(input.service)).rename(input.path, input.name)
      await publishDriveChanges(input.service, [input.path])

      return { ok: true, path: input.path, name: input.name }
    }
  },
  {
    name: 'drive_trash',
    domain: 'drive',
    description: 'Move one or more files or folders to the trash. Entries can be restored from the trash section.',
    input: z.object({ service: serviceInput, paths: pathsInput }),
    writes: true,
    execute: async (raw) => {
      const input = raw as { service: string, paths: string[] }
      await (await useDriveProvider(input.service)).trash(input.paths)
      await publishDriveChanges(input.service, input.paths)
      await publishDriveTrashChange(input.service)

      return { ok: true, trashed: input.paths.length }
    }
  }
]
