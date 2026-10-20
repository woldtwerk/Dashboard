import { useDomainEventBus } from '../../../core/server/utils/domain-events'
import { registerSettings } from '../../../core/server/utils/settings'
import { invalidateMailIdentity } from '../utils/mail-identity'
import { mailSettingsDefaults, mailSettingsSchema } from '../utils/mail-settings'

// Settings section `mail`: which senders may load remote images, the view the
// mail page starts in and the extra From addresses of each account. All belong
// to the mail domain, not to core.
export default defineNitroPlugin(() => {
  registerSettings('mail', mailSettingsSchema, mailSettingsDefaults)

  // Added or removed manual addresses change the sendable list of every
  // account; every worker drops the cached identity on the settings event.
  useDomainEventBus().subscribe((event) => {
    if (event.type === 'changed' && event.resource === 'settings:mail') {
      void invalidateMailIdentity()
    }
  })
})
