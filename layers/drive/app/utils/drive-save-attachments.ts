import type { DriveImportResult } from '../../shared/types/drive'
import type { DriveSaveTarget, DriveSettings } from '../../shared/types/settings'

/** The action id the mail page finds by its `shift_s` kbds */
export const DRIVE_SAVE_ATTACHMENT_ACTION_ID = 'drive-save-attachments'

/** What the save modal hands back to the plugin */
export interface DriveSaveChoice extends DriveSaveTarget {
  checkDuplicates: boolean
}

/** The folder a mail account saved into last, when its drive service still exists */
export function rememberedSaveTarget(
  settings: DriveSettings | undefined,
  mailService: string,
  driveServices?: string[]
): DriveSaveTarget | undefined {
  const target = settings?.saveTargets?.[mailService]
  if (!target) {
    return undefined
  }
  if (driveServices && !driveServices.includes(target.service)) {
    return undefined
  }
  return target
}

/** The settings value with the account's target replaced, keeping every other account. */
export function withSaveTarget(
  settings: DriveSettings | undefined,
  mailService: string,
  target: DriveSaveTarget
): DriveSettings {
  return {
    ...settings,
    saveTargets: {
      ...settings?.saveTargets,
      [mailService]: target
    }
  }
}

function count(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? '' : 's'}`
}

export interface AttachmentSaveToast {
  title: string
  description?: string
  color: 'success' | 'warning' | 'error' | 'neutral'
}

/** The toast text for an import result, e.g. "Saved 2 files to /my-files/…". */
export function attachmentSaveToast(result: DriveImportResult, folder: string): AttachmentSaveToast {
  const saved = result.saved.length
  const duplicates = result.skipped.filter(file => file.reason === 'duplicate').length
  const exists = result.skipped.length - duplicates
  const failed = result.failed.length

  const skipped: string[] = []
  if (duplicates) {
    skipped.push(count(duplicates, 'duplicate'))
  }
  if (exists) {
    skipped.push(`${count(exists, 'file')} already there`)
  }
  const failure = failed ? `${count(failed, 'file')} failed` : undefined
  const description = [skipped.length ? `Skipped ${skipped.join(' and ')}` : '', failure].filter(Boolean).join(' · ') || undefined

  if (saved) {
    return {
      title: `Saved ${count(saved, 'file')} to ${folder}`,
      description,
      color: failed ? 'warning' : 'success'
    }
  }

  if (failed) {
    return {
      title: `${count(failed, 'file')} failed`,
      description: skipped.length ? `Skipped ${skipped.join(' and ')}` : undefined,
      color: 'error'
    }
  }

  if (skipped.length) {
    return { title: `Skipped ${skipped.join(' and ')}`, color: 'success' }
  }

  return { title: 'No files saved', color: 'neutral' }
}
