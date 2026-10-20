/** Where a mail account's attachments were last saved */
export interface DriveSaveTarget {
  service: string
  folder: string
}

/** Settings section `drive`; the drive layer owns it, never the mail layer */
export interface DriveSettings {
  /** Last target per mail service id */
  saveTargets: Record<string, DriveSaveTarget>
}
