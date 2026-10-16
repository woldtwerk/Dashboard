import { describe, expect, it } from 'vitest'
import type { Mailbox } from '../shared/types/mail'
import { buildMailboxTree, mailboxTreeContains } from '../app/utils/mail'

const mailbox = (path: string, extra: Partial<Mailbox> = {}): Mailbox => ({
  path,
  name: path.split('/').at(-1)!,
  delimiter: '/',
  total: 0,
  unread: 0,
  ...extra
})

// What Proton Bridge reports (its "Folders" and "Labels" parents are \Noselect and filtered out)
const proton = [
  mailbox('Trash', { specialUse: '\\Trash' }),
  mailbox('Labels/Receipts', { unread: 1 }),
  mailbox('Folders/Work', { unread: 2 }),
  mailbox('INBOX', { specialUse: '\\Inbox', unread: 5 }),
  mailbox('Folders/Work/Clients', { unread: 3 }),
  mailbox('Sent', { specialUse: '\\Sent' }),
  mailbox('Folders/Archive 2020')
]

describe('buildMailboxTree', () => {
  it('keeps special folders on top and groups custom folders', () => {
    const tree = buildMailboxTree(proton)

    expect(tree.map(node => node.name)).toEqual(['Inbox', 'Sent', 'Trash', 'Folders', 'Labels'])
    expect(tree[3]!.children.map(node => node.name)).toEqual(['Archive 2020', 'Work'])
  })

  it('creates groups for parents that are not mailboxes themselves', () => {
    const folders = buildMailboxTree(proton).find(node => node.name === 'Folders')!

    expect(folders.mailbox).toBeUndefined()
    expect(folders.path).toBe('Folders')
  })

  it('nests subfolders under their selectable parent', () => {
    const work = buildMailboxTree(proton).find(node => node.name === 'Folders')!.children.find(node => node.name === 'Work')!

    expect(work.mailbox?.path).toBe('Folders/Work')
    expect(work.children.map(node => node.path)).toEqual(['Folders/Work/Clients'])
  })

  it('sums unread messages up the tree', () => {
    const tree = buildMailboxTree(proton)
    const folders = tree.find(node => node.name === 'Folders')!

    expect(tree[0]!.unread).toBe(5)
    expect(folders.unread).toBe(5)
    expect(folders.children.find(node => node.name === 'Work')!.unread).toBe(5)
  })

  it('uses the delimiter of the server', () => {
    const tree = buildMailboxTree([mailbox('INBOX.Projects', { delimiter: '.', name: 'Projects' })])

    expect(tree[0]!.name).toBe('INBOX')
    expect(tree[0]!.children[0]!.path).toBe('INBOX.Projects')
  })
})

describe('mailboxTreeContains', () => {
  it('finds the node itself and its descendants', () => {
    const folders = buildMailboxTree(proton).find(node => node.name === 'Folders')!

    expect(mailboxTreeContains(folders, 'Folders/Work/Clients')).toBe(true)
    expect(mailboxTreeContains(folders, 'Folders')).toBe(true)
    expect(mailboxTreeContains(folders, 'Labels/Receipts')).toBe(false)
  })
})
