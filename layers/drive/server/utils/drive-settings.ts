import { z } from 'zod'
import type { DriveSettings } from '../../shared/types/settings'

export const driveSettingsSchema = z.object({
  saveTargets: z.record(
    z.string().min(1),
    z.object({
      service: z.string().min(1),
      folder: z.string().min(1)
    })
  ).default({})
})

export const driveSettingsDefaults: DriveSettings = {
  saveTargets: {}
}
