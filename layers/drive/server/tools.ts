import { z } from 'zod'
import type { DomainTool } from '../../core/shared/types/tools'
import { driveNameSchema, drivePathSchema } from './utils/drive-schema'
import { publishDriveChange, publishDriveChanges, publishDriveTrashChange } from './utils/drive-events'

const serviceInput = z.string().min(1).describe('Drive service id')
const pathInput = drivePathSchema.describe('Absolute path, e.g. "/my-files/Photos"')
const nameInput = driveNameSchema.describe('A single file or folder name, without slashes')
const pathsInput = z.array(drivePathSchema).min(1).max(100).describe('Absolute paths of the entries')

export const driveTools: DomainTool[] = [
  {
    name: 'drive_list',
    domain: 'drive',
    description: 'List the files and folders directly inside a path, with name, type, size and modification date.',
    input: z.object({ service: serviceInput, path: pathInput }),
    writes: false,
    execute: async (raw) => {
      const input = raw as { service: string, path: string }
      return { entries: await (await useDriveProvider(input.service)).list(input.path) }
    }
  },
  {
    name: 'drive_info',
    domain: 'drive',
    description: 'Read one file or folder: its name, type, size, media type and modification date.',
    input: z.object({ service: serviceInput, path: pathInput }),
    writes: false,
    execute: async (raw) => {
      const input = raw as { service: string, path: string }
      return await (await useDriveProvider(input.service)).info(input.path)
    }
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
