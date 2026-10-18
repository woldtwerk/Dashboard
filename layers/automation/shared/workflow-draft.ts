import type { MailAddress } from '../../mail/shared/types/mail'
import type {
  AutomationAction,
  AutomationCondition,
  AutomationDomain,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode
} from './types/automation'

/**
 * The item a draft is built from, as the domain hands it to `ItemActionsMenu`:
 * mail carries the sender, subject and mailbox, documents the title and the
 * names of its correspondent, type and tags.
 */
export interface MailDraftItem {
  from?: MailAddress[]
  to?: MailAddress[]
  subject?: string
  mailbox?: string
  /** Normalized List-Id; a mailing list changes senders less than it changes senders */
  listId?: string
  snippet?: string
}

export interface DocumentsDraftItem {
  title?: string
  correspondent?: string
  documentType?: string
  tags?: string[]
}

export type WorkflowDraftItem = MailDraftItem | DocumentsDraftItem

/** A draft a workflow builder opens with, before the user saves anything */
export interface WorkflowDraft {
  name: string
  graph: WorkflowGraph
}

/**
 * The domain context a draft is built from, as `ItemActionsMenu` hands it out
 * and the builder reads back from `/api/automation/item`.
 */
export interface DraftItemContext {
  domain: AutomationDomain
  ref: string
  item: WorkflowDraftItem
}

/** The action a draft carries as a placeholder; the builder opens the inspector on it */
const PLACEHOLDER_ACTION: Record<AutomationDomain, AutomationAction> = {
  mail: { type: 'star' },
  documents: { type: 'add-tag', tag: 1 }
}

/** Node ids the draft uses, so a caller can focus the action node it should edit */
export const DRAFT_TRIGGER_ID = 'trigger'
export const DRAFT_CONDITION_ID = 'condition-1'
export const DRAFT_ACTION_ID = 'action-1'
export const DRAFT_END_ID = 'end'

/** Words too common to make a condition out of, English and German */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'or', 'to', 'from', 'with', 'your', 're',
  'der', 'die', 'das', 'ein', 'eine', 'einer', 'und', 'oder', 'von', 'für', 'fuer', 'mit', 'zur', 'zum'
])

/**
 * The first word of a title that carries meaning, so a missing correspondent
 * still yields a useful `title contains …` condition. Falls back to the first
 * word as it is when every word is a stopword or a number.
 */
export function firstSignificantWord(title: string): string {
  const words = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return words.find(word => word.length >= 3 && !/^\d+$/.test(word) && !STOPWORDS.has(word.toLocaleLowerCase()))
    ?? words[0]
    ?? ''
}

function senderAddress(item: MailDraftItem): string {
  return item.from?.[0]?.address ?? ''
}

function senderLabel(item: MailDraftItem): string {
  const first = item.from?.[0]
  return first?.name || first?.address || ''
}

function draftGraph(condition: AutomationCondition, action: AutomationAction): WorkflowGraph {
  const nodes: WorkflowNode[] = [
    { id: DRAFT_TRIGGER_ID, type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
    { id: DRAFT_CONDITION_ID, type: 'condition', position: { x: 0, y: 140 }, data: { conditions: { combine: 'all', conditions: [condition] } } },
    { id: DRAFT_ACTION_ID, type: 'action', position: { x: 0, y: 280 }, data: { action } },
    { id: DRAFT_END_ID, type: 'end', position: { x: 320, y: 280 }, data: {} }
  ]

  const edges: WorkflowEdge[] = [
    { id: `${DRAFT_TRIGGER_ID}-next-${DRAFT_CONDITION_ID}`, source: DRAFT_TRIGGER_ID, sourceHandle: 'next', target: DRAFT_CONDITION_ID },
    { id: `${DRAFT_CONDITION_ID}-true-${DRAFT_ACTION_ID}`, source: DRAFT_CONDITION_ID, sourceHandle: 'true', target: DRAFT_ACTION_ID },
    { id: `${DRAFT_CONDITION_ID}-false-${DRAFT_END_ID}`, source: DRAFT_CONDITION_ID, sourceHandle: 'false', target: DRAFT_END_ID },
    { id: `${DRAFT_ACTION_ID}-next-${DRAFT_END_ID}`, source: DRAFT_ACTION_ID, sourceHandle: 'next', target: DRAFT_END_ID }
  ]

  return { version: 1, nodes, edges }
}

/** A draft that watches the sender of one mail: by List-Id when it has one, by address otherwise */
export function mailDraft(item: MailDraftItem): WorkflowDraft {
  const listId = item.listId?.trim()
  const address = senderAddress(item)

  const condition: AutomationCondition = listId
    // A list keeps its id when the individual sender changes, so it is the stabler test
    ? { field: 'listId', op: 'equals', value: listId }
    : address
      ? { field: 'from', op: 'equals', value: address }
      // A mail without a usable sender still needs a non-empty condition
      : { field: 'subject', op: 'contains', value: item.subject?.trim() || '…' }

  const label = senderLabel(item)
  return { name: label ? `Mails from ${label}` : 'Mails from a sender', graph: draftGraph(condition, PLACEHOLDER_ACTION.mail) }
}

/** A draft that watches the correspondent of one document, or its title when there is none */
export function documentsDraft(item: DocumentsDraftItem): WorkflowDraft {
  const correspondent = item.correspondent?.trim()
  const title = item.title?.trim() || 'Untitled'

  const condition: AutomationCondition = correspondent
    ? { field: 'correspondent', op: 'equals', value: correspondent }
    : { field: 'title', op: 'contains', value: firstSignificantWord(title) }

  return {
    name: correspondent ? `Documents from ${correspondent}` : `Documents: ${title}`,
    graph: draftGraph(condition, PLACEHOLDER_ACTION.documents)
  }
}

/**
 * Builds the draft graph for the item a builder was opened from. Pure: the same
 * item always yields the same graph, so the route can build it during setup and
 * the tests can pin it down.
 */
export function draftFromItem(domain: AutomationDomain, item: WorkflowDraftItem): WorkflowDraft {
  return domain === 'mail' ? mailDraft(item as MailDraftItem) : documentsDraft(item as DocumentsDraftItem)
}
