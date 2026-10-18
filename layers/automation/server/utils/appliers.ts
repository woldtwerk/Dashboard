import type {
  AppliedAction,
  AutomationAction,
  AutomationItem,
  UndoOperation
} from '../../shared/types/automation'
import type { AutomationApplier, AutomationLogger } from './engine'

// --- Mail -----------------------------------------------------------------

/** The mail-provider methods the applier uses */
export interface MailActionProvider {
  moveMessage(mailbox: string, uid: number, target: string): Promise<{ uid?: number }>
  addLabel(mailbox: string, uid: number, label: string): Promise<{ uid?: number }>
  setSeen(mailbox: string, uid: number, seen: boolean): Promise<void>
  setFlagged(mailbox: string, uid: number, flagged: boolean): Promise<void>
  deleteMessage(mailbox: string, uid: number): Promise<void>
}

export interface MailApplierContext {
  provider: MailActionProvider
  /** Announces a changed mailbox to the domain event stream */
  publish: (mailbox: string) => Promise<void>
  logger?: AutomationLogger
}

/** The Proton folder a label is filed under */
export const labelMailbox = (label: string) => `Labels/${label}`

/**
 * Applies mail actions one by one, tracking the message's uid across a move (IMAP
 * UIDPLUS gives the new one) so a later action still addresses the same message.
 * Every step records what its reversal needs.
 */
export function createMailApplier(context: MailApplierContext): AutomationApplier {
  return {
    async apply(actions, item) {
      let current: AutomationItem = { ...item }
      const applied: AppliedAction[] = []

      for (const action of actions) {
        if (!current.mailbox || current.uid === undefined) {
          throw new Error('A mail item needs its mailbox and uid')
        }

        switch (action.type) {
          case 'move-to': {
            const { uid } = await context.provider.moveMessage(current.mailbox, current.uid, action.folder)
            applied.push({ type: 'move-to', folder: action.folder, from: current.mailbox, uid })
            await context.publish(current.mailbox)
            await context.publish(action.folder)
            current = { ...current, mailbox: action.folder, uid: uid ?? current.uid }
            break
          }
          case 'label': {
            const target = labelMailbox(action.label)
            const { uid } = await context.provider.addLabel(current.mailbox, current.uid, action.label)
            applied.push({ type: 'label', label: action.label, labelMailbox: target, uid })
            await context.publish(target)
            break
          }
          case 'mark-read': {
            if (current.unread !== true) {
              break
            }
            await context.provider.setSeen(current.mailbox, current.uid, true)
            applied.push({ type: 'mark-read', mailbox: current.mailbox, uid: current.uid, wasUnread: true })
            await context.publish(current.mailbox)
            current = { ...current, unread: false }
            break
          }
          case 'star': {
            if (current.flagged === true) {
              break
            }
            await context.provider.setFlagged(current.mailbox, current.uid, true)
            applied.push({ type: 'star', mailbox: current.mailbox, uid: current.uid, wasFlagged: false })
            await context.publish(current.mailbox)
            current = { ...current, flagged: true }
            break
          }
          default:
            throw new Error(`Action "${action.type}" is not a mail action`)
        }
      }

      return { applied, item: current }
    },

    async undo(operations) {
      for (const operation of operations) {
        await undoMailOperation(context, operation)
      }
    }
  }
}

async function undoMailOperation(context: MailApplierContext, operation: UndoOperation): Promise<void> {
  switch (operation.op) {
    case 'move':
      await context.provider.moveMessage(operation.mailbox, operation.uid, operation.target)
      await context.publish(operation.mailbox)
      await context.publish(operation.target)
      return
    case 'delete':
      await context.provider.deleteMessage(operation.mailbox, operation.uid)
      await context.publish(operation.mailbox)
      return
    case 'set-seen':
      await context.provider.setSeen(operation.mailbox, operation.uid, operation.seen)
      await context.publish(operation.mailbox)
      return
    case 'set-flagged':
      await context.provider.setFlagged(operation.mailbox, operation.uid, operation.flagged)
      await context.publish(operation.mailbox)
      return
    default:
      throw new Error(`"${operation.op}" is not a mail undo step`)
  }
}

// --- Documents ------------------------------------------------------------

/** The document-provider methods the applier uses */
export interface DocumentsActionProvider {
  get(id: number): Promise<{ id: number, tags: number[], correspondent: number | null, documentType: number | null }>
  update(id: number, patch: { tags?: number[], correspondent?: number | null, documentType?: number | null }): Promise<unknown>
}

export interface DocumentsApplierContext {
  provider: DocumentsActionProvider
  /** Announces a changed service to the domain event stream */
  publish: () => Promise<void>
  logger?: AutomationLogger
}

/** Applies document actions, capturing the previous metadata so an undo can restore it */
export function createDocumentsApplier(context: DocumentsApplierContext): AutomationApplier {
  return {
    async apply(actions, item) {
      if (item.documentId === undefined) {
        throw new Error('A document item needs its document id')
      }
      const id = item.documentId
      const before = await context.provider.get(id)
      const applied: AppliedAction[] = []

      for (const action of actions) {
        switch (action.type) {
          case 'add-tag': {
            if (before.tags.includes(action.tag)) {
              continue
            }
            const tags = [...before.tags, action.tag]
            await context.provider.update(id, { tags })
            applied.push({ type: 'add-tag', document: id, tag: action.tag, previousTags: before.tags })
            break
          }
          case 'set-correspondent': {
            if (before.correspondent === action.correspondent) {
              continue
            }
            await context.provider.update(id, { correspondent: action.correspondent })
            applied.push({ type: 'set-correspondent', document: id, correspondent: action.correspondent, previous: before.correspondent })
            break
          }
          case 'set-type': {
            if (before.documentType === action.documentType) {
              continue
            }
            await context.provider.update(id, { documentType: action.documentType })
            applied.push({ type: 'set-type', document: id, documentType: action.documentType, previous: before.documentType })
            break
          }
          default:
            throw new Error(`Action "${action.type}" is not a document action`)
        }
      }

      if (applied.length) {
        await context.publish()
      }

      return { applied, item }
    },

    async undo(operations) {
      for (const operation of operations) {
        switch (operation.op) {
          case 'set-tags':
            await context.provider.update(operation.document, { tags: operation.tags })
            break
          case 'set-correspondent':
            await context.provider.update(operation.document, { correspondent: operation.correspondent })
            break
          case 'set-document-type':
            await context.provider.update(operation.document, { documentType: operation.documentType })
            break
          default:
            throw new Error(`"${operation.op}" is not a document undo step`)
        }
      }
      await context.publish()
    }
  }
}

/** How the action list of a failed/partial run reads in a log line */
export function describeActions(actions: AutomationAction[]): string {
  return actions.map(action => action.type).join(', ')
}
