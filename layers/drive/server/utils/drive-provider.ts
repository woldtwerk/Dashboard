import { createError } from 'nuxt/server'
import type { SetupValues } from '../../../core/shared/types/setup'
import type { DriveEntry, DriveInvitation, DriveShare, DriveShareOptions } from '../../shared/types/drive'

/** The request stream and its headers, forwarded verbatim to the provider. */
export interface DriveUpload {
  stream: ReadableStream<Uint8Array> | null
  contentType?: string
  contentLength?: string
}

/** Port every drive provider adapter implements. */
export interface DriveProvider {
  /** Entries directly inside `path`; `path` may be the root or a section */
  list(path: string): Promise<DriveEntry[]>
  info(path: string): Promise<DriveEntry>
  createFolder(parentPath: string, name: string): Promise<void>
  /** Streams an upload (multipart body) into `path` */
  upload(path: string, upload: DriveUpload): Promise<void>
  /** Streams the selected entries back as an archive or a single file */
  download(paths: string[]): Promise<Response>
  rename(path: string, name: string): Promise<void>
  move(paths: string[], target: string): Promise<void>
  copy(paths: string[], target: string, name?: string): Promise<void>
  /** Moves entries into the trash; `restore` undoes it */
  trash(paths: string[]): Promise<void>
  restore(paths: string[]): Promise<void>
  /** Removes entries permanently, bypassing the trash */
  remove(paths: string[]): Promise<void>
  emptyTrash(): Promise<void>

  // --- Public links ---
  share(path: string): Promise<DriveShare>
  setShare(path: string, options: DriveShareOptions): Promise<DriveShare>
  removeShare(path: string): Promise<void>

  // --- Invitations to folders others shared ---
  listInvitations(): Promise<DriveInvitation[]>
  setInvitation(uid: string, accept: boolean): Promise<void>
}

/** Creates a provider from the settings of one service instance */
export type DriveProviderFactory = (values: SetupValues) => DriveProvider

const providers = new Map<string, DriveProviderFactory>()

export function registerDriveProvider(connector: string, factory: DriveProviderFactory) {
  providers.set(connector, factory)
}

export async function useDriveProvider(serviceId: string): Promise<DriveProvider> {
  const service = await getService(serviceId, 'drive')
  const factory = providers.get(service.connector)

  if (!factory) {
    throw createError({ status: 503, statusText: `Drive provider "${service.connector}" is not available` })
  }

  return factory(service.values)
}
