import { createError } from 'nuxt/server'
import type { SetupValues } from '../../../core/shared/types/setup'
import type { DriveProvider, DriveUpload } from '../../../drive/server/utils/drive-provider'
import type { DriveEntry, DriveInvitation, DriveShare } from '../../../drive/shared/types/drive'
import { useProtonDriveControl } from './control'
import {
  buildCopyArgs,
  buildCreateFolderArgs,
  buildDeleteArgs,
  buildEmptyTrashArgs,
  buildInfoArgs,
  buildInvitationArgs,
  buildInvitationListArgs,
  buildListArgs,
  buildMoveArgs,
  buildRemoveShareArgs,
  buildRenameArgs,
  buildRestoreArgs,
  buildSetShareArgs,
  buildShareStatusArgs,
  buildTrashArgs,
  parseEntries,
  parseEntry,
  parseInvitations,
  parseShare
} from './drive-command'

/** The last meaningful line of a CLI failure, skipping its `=` banner. */
function errorLine(stderr: string): string {
  const lines = stderr.split('\n').map(line => line.trim()).filter(line => line && !/^=+$/.test(line))
  return lines.at(-1) ?? ''
}

export function createProtonDriveProvider(_values: SetupValues): DriveProvider {
  const control = useProtonDriveControl()

  async function stdoutOf(argv: string[], action: string): Promise<string> {
    const result = await control.command(argv)
    if (result.exitCode !== 0) {
      throw createError({ status: 502, statusText: errorLine(result.stderr) || `Proton Drive could not ${action}` })
    }
    return result.stdout
  }

  async function run(argv: string[], action: string): Promise<void> {
    await stdoutOf(argv, action)
  }

  return {
    async list(path): Promise<DriveEntry[]> {
      return parseEntries(await stdoutOf(buildListArgs(path), 'list the folder'), path)
    },

    async info(path): Promise<DriveEntry> {
      const entry = parseEntry(await stdoutOf(buildInfoArgs(path), 'read the entry'), path)
      if (!entry) {
        throw createError({ status: 404, statusText: 'Entry not found' })
      }
      return entry
    },

    createFolder(parentPath, name) {
      return run(buildCreateFolderArgs(parentPath, name), 'create the folder')
    },

    async upload(path, upload: DriveUpload): Promise<void> {
      const init: RequestInit & { duplex?: 'half' } = {
        method: 'POST',
        headers: {
          ...control.headers,
          ...upload.contentType ? { 'content-type': upload.contentType } : {},
          ...upload.contentLength ? { 'content-length': upload.contentLength } : {}
        }
      }
      // Stream the body straight through, so a large file is never buffered
      if (upload.stream) {
        init.body = upload.stream as unknown as BodyInit
        init.duplex = 'half'
      }

      const response = await fetch(`${control.url}/upload?path=${encodeURIComponent(path)}`, init)

      const result = await response.json().catch(() => ({})) as { exitCode?: number, stderr?: string, error?: string }
      if (!response.ok) {
        throw createError({ status: response.status, statusText: result.error || 'Proton Drive could not upload the files' })
      }
      if (result.exitCode !== 0) {
        throw createError({ status: 502, statusText: errorLine(result.stderr ?? '') || 'Proton Drive could not upload the files' })
      }
    },

    async download(paths): Promise<Response> {
      const params = new URLSearchParams()
      for (const path of paths) {
        params.append('path', path)
      }

      const response = await fetch(`${control.url}/download?${params.toString()}`, { headers: control.headers })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw createError({ status: response.status, statusText: body.error || 'Proton Drive could not download the files' })
      }
      return response
    },

    rename(path, name) {
      return run(buildRenameArgs(path, name), 'rename the entry')
    },

    move(paths, target) {
      return run(buildMoveArgs(paths, target), 'move the selection')
    },

    copy(paths, target, name) {
      return run(buildCopyArgs(paths, target, name), 'copy the selection')
    },

    trash(paths) {
      return run(buildTrashArgs(paths), 'move to trash')
    },

    restore(paths) {
      return run(buildRestoreArgs(paths), 'restore the selection')
    },

    remove(paths) {
      return run(buildDeleteArgs(paths), 'delete the selection')
    },

    emptyTrash() {
      return run(buildEmptyTrashArgs(), 'empty the trash')
    },

    async share(path): Promise<DriveShare> {
      return parseShare(await stdoutOf(buildShareStatusArgs(path), 'read the share link'))
    },

    async setShare(path, options): Promise<DriveShare> {
      return parseShare(await stdoutOf(buildSetShareArgs(path, options), 'set the share link'))
    },

    removeShare(path) {
      return run(buildRemoveShareArgs(path), 'remove the share link')
    },

    async listInvitations(): Promise<DriveInvitation[]> {
      return parseInvitations(await stdoutOf(buildInvitationListArgs(), 'list invitations'))
    },

    setInvitation(uid, accept) {
      return run(buildInvitationArgs(uid, accept), accept ? 'accept the invitation' : 'reject the invitation')
    }
  }
}

/** Verifies the container is signed in, e.g. when the service is saved. */
export async function testProtonDriveConnection(): Promise<void> {
  const { signedIn } = await useProtonDriveControl().status()
  if (!signedIn) {
    throw createError({ status: 400, statusText: 'Sign in to Proton Drive first' })
  }
}
