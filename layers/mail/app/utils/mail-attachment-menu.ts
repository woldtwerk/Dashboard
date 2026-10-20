import type { DropdownMenuItem } from '@nuxt/ui'
import type { AttachmentAction, AttachmentActionContext } from '#layers/core/app/utils/attachment-actions'
import { attachmentActionsFor } from '#layers/core/app/utils/attachment-actions'
import { MAIL_SHORTCUT_KEYS } from './mail-shortcuts'

export interface MailAttachmentMenuHandlers {
  preview: () => void
  download: () => void
  action: (action: AttachmentAction) => void
}

/**
 * The menu of one attachment: the mail-owned preview and download entries, then
 * every action another layer registered. A registered action keeps its own kbds,
 * so a badge cannot advertise a key the page does not bind.
 */
export function mailAttachmentMenuItems(
  context: AttachmentActionContext,
  handlers: MailAttachmentMenuHandlers
): DropdownMenuItem[][] {
  const groups: DropdownMenuItem[][] = [[
    {
      label: 'Preview',
      icon: 'i-lucide-eye',
      kbds: [...MAIL_SHORTCUT_KEYS.preview],
      onSelect: () => handlers.preview()
    },
    {
      label: 'Download',
      icon: 'i-lucide-download',
      kbds: [...MAIL_SHORTCUT_KEYS.download],
      onSelect: () => handlers.download()
    }
  ]]

  const actions = attachmentActionsFor(context).map(action => ({
    label: action.label,
    icon: action.icon,
    ...(action.kbds ? { kbds: action.kbds } : {}),
    onSelect: () => handlers.action(action)
  }))

  if (actions.length) {
    groups.push(actions)
  }

  return groups
}
