/** What an entry is; only folders can be entered. */
export type DriveEntryType = 'folder' | 'file'

/** A file or folder as the explorer sees it. */
export interface DriveEntry {
  /** Provider-unique identifier of the entry */
  uid: string
  name: string
  type: DriveEntryType
  /** Path of the folder that holds it */
  parent: string
  /** Full path of the entry; the explorer keys entries and selections by it */
  path: string
  /** Bytes; only known for files */
  size?: number
  /** ISO 8601 timestamp of the last change */
  modified?: string
  /** IANA media type, e.g. `image/png` */
  mediaType?: string
  /** Set while an optimistic change is not yet confirmed by the provider */
  pending?: boolean
}

/** Which of the three top-level areas the explorer shows. */
export type DriveSectionKey = 'my-files' | 'shared' | 'trash'

export interface DriveSection {
  key: DriveSectionKey
  label: string
  icon: string
  /** Filesystem path the section lists */
  root: string
  /** Only this section lists share invitations */
  listsInvitations?: boolean
  /** Only this section can be emptied */
  emptyable?: boolean
}

/** A public share link as reported by the provider. */
export interface DriveShare {
  shared: boolean
  url?: string
  /** Access role of the link, e.g. `viewer` or `editor` */
  role?: string
  /** Whether the link is protected by a password */
  passwordProtected?: boolean
  /** ISO 8601 expiry, if any */
  expiration?: string
}

/** Options a new share link is created with. */
export interface DriveShareOptions {
  role?: string
  password?: string
  expiration?: string
}

/** An invitation to a folder someone else shared with the account. */
export interface DriveInvitation {
  uid: string
  name: string
  /** Address or name of the account that shared it */
  from?: string
}

/** How the explorer orders a folder listing. */
export type DriveSort = 'name' | 'modified' | 'size'
export type DriveOrder = 'asc' | 'desc'
export type DriveView = 'grid' | 'list'

/** What the import endpoint saved and skipped; a failing part does not discard the rest */
export interface DriveImportResult {
  saved: string[]
  skipped: Array<{ name: string, reason: 'duplicate' | 'exists' }>
  failed: Array<{ part: string, reason: string }>
}
