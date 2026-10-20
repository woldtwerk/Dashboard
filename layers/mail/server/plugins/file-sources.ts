import { registerFileSource } from '../../../core/server/utils/file-sources'
import { mailRefTarget } from '../../shared/mail-attachments'

/**
 * Lets other layers read mail attachments through the core file-source registry.
 * The ref is a mail entity key, so the drive import never imports the mail layer.
 */
export default defineNitroPlugin(() => {
  registerFileSource('mail', {
    async open(ref, part) {
      const target = mailRefTarget(ref)
      if (!target) {
        return null
      }

      const provider = await useMailProvider(target.service)
      return provider.openAttachment ? await provider.openAttachment(target.mailbox, target.uid, part) : null
    },

    async list(ref) {
      const target = mailRefTarget(ref)
      if (!target) {
        return []
      }

      const provider = await useMailProvider(target.service)
      return provider.listAttachments ? await provider.listAttachments(target.mailbox, target.uid) : []
    }
  })
})
