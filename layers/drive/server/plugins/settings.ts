import { registerSettings } from '../../../core/server/utils/settings'
import { driveSettingsDefaults, driveSettingsSchema } from '../utils/drive-settings'

// Settings section `drive`: where each mail account last saved its attachments.
// It belongs to the drive layer, so the mail layer never reads or writes it.
export default defineNitroPlugin(() => {
  registerSettings('drive', driveSettingsSchema, driveSettingsDefaults)
})
