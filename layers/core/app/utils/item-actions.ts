import type { DropdownMenuItem } from '@nuxt/ui'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

/**
 * The item a domain offers its actions for. A domain renders `ItemActionsMenu`
 * with this context; the core never interprets `item`, it only hands it to the
 * registered actions.
 */
export interface ItemActionContext {
  /** The domain the item belongs to, e.g. `mail` or `documents` */
  domain: string
  /** The service the item lives in */
  service: string
  /** The item's entity key (`type:service:id`), e.g. what a workflow starts from */
  ref: string
  /** Domain specific fields an action may read */
  item: Record<string, unknown>
}

/**
 * An action one layer contributes to another domain's items, e.g. "Create
 * workflow…". Registered from a plugin; the domain knows nothing about it.
 */
export interface ItemAction {
  /** Unique across layers, e.g. `automation-create-workflow` */
  id: string
  label: string
  icon: string
  /** The domains this action shows up for */
  domains: string[]
  /** Lower comes first; ties break by label, then id */
  order?: number
  /** Where the action goes for one item; undefined hides it for that item */
  to: (context: ItemActionContext) => RouteLocationRaw | undefined
  /** Whether the action applies to this item at all */
  visible?: (context: ItemActionContext) => boolean
}

/** Actions without an explicit order come after the ones that name one */
export const ITEM_ACTION_DEFAULT_ORDER = 100

const actions = new Map<string, ItemAction>()

/** Called by a layer's plugin; the core knows nothing domain-specific */
export function registerItemAction(action: ItemAction) {
  actions.set(action.id, action)
}

/** Test hook; a client render registers its actions once at startup */
export function resetItemActions() {
  actions.clear()
}

/** The registered actions of one domain for one item, in menu order */
export function itemActionsFor(
  domain: string,
  context: ItemActionContext = { domain, service: '', ref: '', item: {} }
): ItemAction[] {
  return [...actions.values()]
    .filter(action => action.domains.includes(domain))
    .filter(action => action.visible ? action.visible(context) : true)
    .sort((left, right) =>
      (left.order ?? ITEM_ACTION_DEFAULT_ORDER) - (right.order ?? ITEM_ACTION_DEFAULT_ORDER)
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id))
}

/** The registered actions for one item; the context names its domain */
export function useItemActions(context: MaybeRefOrGetter<ItemActionContext>): ComputedRef<ItemAction[]> {
  return computed(() => {
    const value = toValue(context)
    return itemActionsFor(value.domain, value)
  })
}

/**
 * The dropdown a domain renders: its own entries first, then one group with the
 * registered actions whose `to` resolved for this item.
 */
export function itemActionMenuItems(
  domain: string,
  context: ItemActionContext,
  leading: DropdownMenuItem[][] = []
): DropdownMenuItem[][] {
  const items = itemActionsFor(domain, context)
    .map((action): DropdownMenuItem | undefined => {
      const to = action.to(context)
      return to ? { label: action.label, icon: action.icon, to } : undefined
    })
    .filter((entry): entry is DropdownMenuItem => !!entry)

  return [...leading, ...(items.length ? [items] : [])]
}
