import type { MaybeRefOrGetter } from 'vue'
import type { FileSourceMeta } from '#layers/core/shared/types/file-sources'

/**
 * What an attachment action may read. `source` names the file source (`mail`),
 * `ref` is the source's opaque reference and `attachments` are the files the
 * action was invoked for.
 */
export interface AttachmentActionContext {
  source: string
  ref: string
  attachments: FileSourceMeta[]
}

/**
 * An action one layer contributes to another domain's attachments, e.g. "Save
 * to drive". Registered from a plugin; the domain knows nothing about it.
 */
export interface AttachmentAction {
  /** Unique across layers, e.g. `drive-save-attachments` */
  id: string
  label: string
  icon: string
  /** Keyboard shortcuts the action advertises, e.g. `shift_s` */
  kbds?: string[]
  /** Lower comes first; ties break by label, then id */
  order?: number
  /** Whether the action applies to these attachments at all */
  visible?: (context: AttachmentActionContext) => boolean
  run: (context: AttachmentActionContext) => void | Promise<void>
}

/** Actions without an explicit order come after the ones that name one */
export const ATTACHMENT_ACTION_DEFAULT_ORDER = 100

const actions = new Map<string, AttachmentAction>()

/** Called by a layer's plugin; the core knows nothing domain-specific */
export function registerAttachmentAction(action: AttachmentAction) {
  actions.set(action.id, action)
}

/** Test hook; a client render registers its actions once at startup */
export function resetAttachmentActions() {
  actions.clear()
}

/** The registered actions for one attachment context, in menu order */
export function attachmentActionsFor(context: AttachmentActionContext): AttachmentAction[] {
  return [...actions.values()]
    .filter(action => action.visible ? action.visible(context) : true)
    .sort((left, right) =>
      (left.order ?? ATTACHMENT_ACTION_DEFAULT_ORDER) - (right.order ?? ATTACHMENT_ACTION_DEFAULT_ORDER)
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id))
}

/** The actions that advertise `key`, so a page shortcut runs whatever claims it. */
export function attachmentActionsForKey(context: AttachmentActionContext, key: string): AttachmentAction[] {
  return attachmentActionsFor(context).filter(action => action.kbds?.includes(key))
}

/** A reactive version of {@link attachmentActionsFor}, for a rendered attachment. */
export function useAttachmentActions(context: MaybeRefOrGetter<AttachmentActionContext>) {
  return computed(() => attachmentActionsFor(toValue(context)))
}
