import type { NavigationMenuChildItem } from '@nuxt/ui'
import type { Mailbox, MailFolders } from '#layers/mail/shared/types/mail'

/** Sidebar submenu of "Mail": folder tree, grouped by account when there is more than one */
export function useMailNavigation() {
  const route = useRoute()
  const { data: folders } = useMailFolders()

  return computed<NavigationMenuChildItem[]>(() => {
    const activeService = route.query.service ?? folders.value[0]?.service.id
    const activeMailbox = String(route.query.mailbox ?? 'INBOX')
    const onMail = route.path === '/mail'

    const folderItems = ({ service, mailboxes, error }: MailFolders): NavigationMenuChildItem[] => {
      if (error) {
        return [{ label: error, icon: 'i-lucide-circle-alert', disabled: true }]
      }

      const isActiveService = onMail && activeService === service.id

      const link = (mailbox: Mailbox, label = mailboxLabel(mailbox)): NavigationMenuChildItem => ({
        label,
        icon: mailboxIcon(mailbox),
        to: { path: '/mail', query: { service: service.id, mailbox: mailbox.path } },
        badge: mailbox.unread || undefined,
        // Router links ignore the query, so mark the active folder explicitly
        active: isActiveService && activeMailbox === mailbox.path
      })

      const toItem = (node: MailboxNode): NavigationMenuChildItem => {
        if (!node.children.length) {
          return link(node.mailbox!)
        }

        // Custom folders and labels: collapsible, open while it holds the current folder
        const children = node.children.map(toItem)
        return {
          label: node.name,
          icon: node.mailbox ? mailboxIcon(node.mailbox) : 'i-lucide-folders',
          badge: node.unread || undefined,
          defaultOpen: isActiveService && mailboxTreeContains(node, activeMailbox),
          children: node.mailbox ? [link(node.mailbox), ...children] : children
        }
      }

      return buildMailboxTree(mailboxes).map(toItem)
    }

    if (folders.value.length === 1) {
      return folderItems(folders.value[0]!)
    }

    return folders.value.map(entry => ({
      label: entry.service.name,
      icon: entry.service.icon,
      defaultOpen: true,
      children: folderItems(entry)
    }))
  })
}
