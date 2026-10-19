import type { ContextMenuItem } from '@nuxt/ui'
import type { MailSummary } from '#layers/mail/shared/types/mail'
import type { ItemActionContext } from '#layers/core/app/utils/item-actions'
import { entityKey } from '#layers/core/shared/entities'

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
  options: { permanent: boolean, deletable?: boolean, kbds?: boolean },
  handlers: MailContextMenuHandlers
): ContextMenuItem[][] {
  // A view whose shortcuts differ (or that has none) hides the badges
  const shortcut = (keys: string[]) => options.kbds === false ? {} : { kbds: keys }

  const groups: ContextMenuItem[][] = [
    [{
      label: 'Open',
      icon: 'i-lucide-mail-open',
      onSelect: () => handlers.open()
    }],
    [{
      label: 'Reply',
      icon: 'i-lucide-reply',
      ...shortcut(['r']),
      onSelect: () => handlers.compose('reply')
    }, {
      label: 'Reply all',
      icon: 'i-lucide-reply-all',
      ...shortcut(['a']),
      onSelect: () => handlers.compose('replyAll')
    }, {
      label: 'Forward',
      icon: 'i-lucide-forward',
      ...shortcut(['f']),
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
      ...shortcut(['#']),
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
