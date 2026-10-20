import type { ContextMenuItem } from '@nuxt/ui'
import type { MailSummary } from '#layers/mail/shared/types/mail'
import type { ItemActionContext } from '#layers/core/app/utils/item-actions'
import { entityKey } from '#layers/core/shared/entities'
import { MAIL_SHORTCUT_KEYS, type MailShortcutAction } from './mail-shortcuts'

/** What the rows of a list do when their context menu is used */
export interface MailContextMenuHandlers {
  open: () => void
  compose: (mode: 'reply' | 'replyAll' | 'forward') => void
  toggleUnread: () => void
  delete: () => void
}

/**
 * The domain owned groups of a mail's context menu: open, answer, read state
 * and — where it applies — delete. Other layers' item actions are appended by
 * the component through `itemActionMenuItems`.
 */
export function mailContextMenuItems(
  mail: Pick<MailSummary, 'unread'>,
  options: { permanent: boolean, deletable?: boolean },
  handlers: MailContextMenuHandlers
): ContextMenuItem[][] {
  // Every entry that names a key gets it from the one place the page binds them,
  // so a badge cannot advertise a shortcut that does nothing
  const shortcut = (action: MailShortcutAction) => ({ kbds: [...MAIL_SHORTCUT_KEYS[action]] })

  const groups: ContextMenuItem[][] = [
    [{
      label: 'Open',
      icon: 'i-lucide-mail-open',
      onSelect: () => handlers.open()
    }],
    [{
      label: 'Reply',
      icon: 'i-lucide-reply',
      ...shortcut('reply'),
      onSelect: () => handlers.compose('reply')
    }, {
      label: 'Reply all',
      icon: 'i-lucide-reply-all',
      ...shortcut('replyAll'),
      onSelect: () => handlers.compose('replyAll')
    }, {
      label: 'Forward',
      icon: 'i-lucide-forward',
      ...shortcut('forward'),
      onSelect: () => handlers.compose('forward')
    }],
    [mail.unread
      ? {
          label: 'Mark as read',
          icon: 'i-lucide-mail-open',
          onSelect: () => handlers.toggleUnread()
        }
      : {
          label: 'Mark as unread',
          icon: 'i-lucide-mail',
          onSelect: () => handlers.toggleUnread()
        }]
  ]

  // A whole conversation has no single mail to delete
  if (options.deletable !== false) {
    groups.push([{
      label: options.permanent ? 'Delete forever' : 'Delete',
      icon: 'i-lucide-trash-2',
      ...shortcut('delete'),
      ...(options.permanent ? { color: 'error' as const } : {}),
      onSelect: () => handlers.delete()
    }])
  }

  return groups
}

/** What several targeted mails or conversations do when their menu is used */
export interface MailBatchContextMenuHandlers {
  markRead: () => void
  markUnread: () => void
  delete: () => void
}

/**
 * The domain owned groups of a menu that acts on several targets: the label says
 * how many, then both read states, then — where it applies — delete.
 */
export function mailBatchContextMenuItems(
  label: string,
  options: { permanent: boolean, deletable?: boolean },
  handlers: MailBatchContextMenuHandlers
): ContextMenuItem[][] {
  const groups: ContextMenuItem[][] = [
    [{ label, type: 'label' }],
    [{
      label: 'Mark as read',
      icon: 'i-lucide-mail-open',
      onSelect: () => handlers.markRead()
    }, {
      label: 'Mark as unread',
      icon: 'i-lucide-mail',
      onSelect: () => handlers.markUnread()
    }]
  ]

  if (options.deletable !== false) {
    groups.push([{
      label: options.permanent ? 'Delete forever' : 'Delete',
      icon: 'i-lucide-trash-2',
      kbds: [...MAIL_SHORTCUT_KEYS.delete],
      ...(options.permanent ? { color: 'error' as const } : {}),
      onSelect: () => handlers.delete()
    }])
  }

  return groups
}

/** What other layers' item actions may read from a list row */
export function mailItemContext(mail: MailSummary, service: string): ItemActionContext {
  return {
    domain: 'mail',
    service,
    ref: entityKey({ type: 'mail', service, id: `${mail.mailbox}/${mail.uid}` }),
    item: {
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      mailbox: mail.mailbox,
      listId: mail.listId,
      snippet: mail.snippet
    }
  }
}
