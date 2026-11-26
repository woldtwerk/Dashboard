import type { DriveEntry } from './types/drive'
import type { FilePreviewKind } from '../../core/shared/file-preview'
import { filePreviewKind } from '../../core/shared/file-preview'

export type DrivePreviewKind = FilePreviewKind

/** How a file can be previewed inline, or undefined when it cannot. */
export function previewKind(entry: Pick<DriveEntry, 'type' | 'mediaType' | 'name'>): DrivePreviewKind | undefined {
  if (entry.type === 'folder') {
    return undefined
  }
  return filePreviewKind(entry.mediaType, entry.name)
}

/** The largest image whose whole file is worth fetching as a grid thumbnail. */
export const THUMBNAIL_MAX_BYTES = 50 * 1024 * 1024

/** Width of the 1x derivative for a grid tile; the 2x candidate is twice that. */
export const THUMBNAIL_TILE_WIDTH = 256

/** Width of the 1x derivative for a list row's icon; the 2x candidate is twice that. */
export const THUMBNAIL_ICON_WIDTH = 64

/**
 * Whether a tile shows the file itself instead of its icon. Only images small
 * enough to be downloaded at grid size qualify; an entry of unknown size is not
 * fetched, since it cannot be shown to be small.
 */
export function thumbnailAllowed(entry: Pick<DriveEntry, 'type' | 'name' | 'mediaType' | 'size'>): boolean {
  return previewKind(entry) === 'image'
    && entry.size !== undefined
    && entry.size <= THUMBNAIL_MAX_BYTES
}

/**
 * The version token of an entry, derived from its modification time and size.
 * It rides along as `v` so the download endpoint can build an ETag without an
 * extra CLI call, and so the browser cache hits again on a revisit.
 */
export function entryVersion(entry: Pick<DriveEntry, 'modified' | 'size'>): string {
  // Without metadata there is no version: an unversioned original must not be cached.
  if (entry.modified === undefined && entry.size === undefined) {
    return ''
  }
  return `${entry.modified ?? ''}-${entry.size ?? ''}`
}
