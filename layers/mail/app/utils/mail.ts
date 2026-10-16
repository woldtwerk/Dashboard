import type { MailAddress, Mailbox } from '#layers/mail/shared/types/mail'

export function formatMailAddress(address?: MailAddress): string {
  return address?.name || address?.address || 'Unknown sender'
}

const SPECIAL_USE: Record<string, { icon: string, order: number }> = {
  '\\Inbox': { icon: 'i-lucide-inbox', order: 0 },
  '\\Flagged': { icon: 'i-lucide-star', order: 1 },
  '\\Drafts': { icon: 'i-lucide-file-pen', order: 2 },
  '\\Sent': { icon: 'i-lucide-send', order: 3 },
  '\\Archive': { icon: 'i-lucide-archive', order: 4 },
  '\\All': { icon: 'i-lucide-mails', order: 5 },
  '\\Junk': { icon: 'i-lucide-shield-alert', order: 6 },
  '\\Trash': { icon: 'i-lucide-trash-2', order: 7 }
}

/** Display name; IMAP calls the inbox "INBOX" */
export function mailboxLabel(mailbox: Mailbox): string {
  return mailbox.path.toUpperCase() === 'INBOX' ? 'Inbox' : mailbox.name
}

export function mailboxIcon(mailbox: Mailbox): string {
  return SPECIAL_USE[mailbox.specialUse ?? '']?.icon ?? 'i-lucide-folder'
}

/** Special folders first (Inbox, Starred, ...), then the rest alphabetically */
export function sortMailboxes(mailboxes: Mailbox[]): Mailbox[] {
  const order = (mailbox: Mailbox) => SPECIAL_USE[mailbox.specialUse ?? '']?.order ?? 100
  return [...mailboxes].sort((a, b) => order(a) - order(b) || a.path.localeCompare(b.path))
}

export interface MailboxNode {
  name: string
  path: string
  /** Missing for pure groups, e.g. Proton's "Folders" and "Labels" */
  mailbox?: Mailbox
  /** Own unread messages plus those of all descendants */
  unread: number
  children: MailboxNode[]
}

const nodeOrder = (node: MailboxNode) => SPECIAL_USE[node.mailbox?.specialUse ?? '']?.order ?? 100

/** Folder hierarchy from the mailbox paths; special folders first, then the rest alphabetically */
export function buildMailboxTree(mailboxes: Mailbox[]): MailboxNode[] {
  const roots: MailboxNode[] = []
  const nodes = new Map<string, MailboxNode>()

  const ensure = (segments: string[], delimiter: string): MailboxNode => {
    const path = segments.join(delimiter)
    let node = nodes.get(path)
    if (!node) {
      node = { name: segments.at(-1)!, path, unread: 0, children: [] }
      nodes.set(path, node)
      const siblings = segments.length > 1 ? ensure(segments.slice(0, -1), delimiter).children : roots
      siblings.push(node)
    }
    return node
  }

  for (const mailbox of mailboxes) {
    const delimiter = mailbox.delimiter || '/'
    const node = ensure(mailbox.path.split(delimiter), delimiter)
    node.mailbox = mailbox
    node.name = mailboxLabel(mailbox)
  }

  const finalize = (list: MailboxNode[]) => {
    list.sort((a, b) => nodeOrder(a) - nodeOrder(b) || a.name.localeCompare(b.name))
    for (const node of list) {
      finalize(node.children)
      node.unread = (node.mailbox?.unread ?? 0) + node.children.reduce((sum, child) => sum + child.unread, 0)
    }
  }
  finalize(roots)

  return roots
}

/** Whether the node or one of its descendants is the given path */
export function mailboxTreeContains(node: MailboxNode, path: string): boolean {
  return node.path === path || node.children.some(child => mailboxTreeContains(child, path))
}
