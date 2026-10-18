import { registerSettings } from '../../../core/server/utils/settings'
import { mailSettingsDefaults, mailSettingsSchema } from '../utils/mail-settings'

// Settings section `mail`: which senders may load remote images, and the view
// the mail page starts in. Both belong to the mail domain, not to core.
export default defineNitroPlugin(() => {
  registerSettings('mail', mailSettingsSchema, mailSettingsDefaults)
})
