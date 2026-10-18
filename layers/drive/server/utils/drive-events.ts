import { DRIVE_TRASH_ROOT, parentPath } from '../../shared/drive-path'

/** Announces a change in one folder listing. */
export async function publishDriveChange(service: string, resource?: string): Promise<void> {
  await publishDomainEvent({ domain: 'drive', service, type: 'changed', resource })
}

/** Announces changes in every folder that held one of `paths`. */
export async function publishDriveChanges(service: string, paths: string[]): Promise<void> {
  for (const resource of new Set(paths.map(parentPath))) {
    await publishDriveChange(service, resource)
  }
}

/** Announces a change in the trash listing. */
export async function publishDriveTrashChange(service: string): Promise<void> {
  await publishDriveChange(service, DRIVE_TRASH_ROOT)
}
