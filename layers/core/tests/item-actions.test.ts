import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  itemActionMenuItems,
  itemActionsFor,
  registerItemAction,
  resetItemActions
} from '../app/utils/item-actions'
import type { ItemAction, ItemActionContext } from '../app/utils/item-actions'

function context(overrides: Partial<ItemActionContext> = {}): ItemActionContext {
  return { domain: 'mail', service: 'mail-1', ref: 'mail:mail-1:INBOX%2F1', item: {}, ...overrides }
}

const action = (overrides: Partial<ItemAction> = {}): ItemAction => ({
  id: 'a',
  label: 'Action',
  icon: 'i-lucide-star',
  domains: ['mail'],
  to: () => '/somewhere',
  ...overrides
})

beforeEach(() => {
  resetItemActions()
})

describe('itemActionsFor', () => {
  it('orders actions by order, then label', () => {
    registerItemAction(action({ id: 'late', label: 'Late', order: 50 }))
    registerItemAction(action({ id: 'early', label: 'Early', order: 10 }))
    registerItemAction(action({ id: 'none', label: 'No order' }))

    expect(itemActionsFor('mail', context()).map(entry => entry.id)).toEqual(['early', 'late', 'none'])
  })

  it('keeps a deterministic order for equal order numbers', () => {
    registerItemAction(action({ id: 'b', label: 'Bravo', order: 10 }))
    registerItemAction(action({ id: 'a', label: 'Alpha', order: 10 }))

    expect(itemActionsFor('mail', context()).map(entry => entry.id)).toEqual(['a', 'b'])
  })

  it('only returns actions whose domains include the requested one', () => {
    registerItemAction(action({ id: 'mail', domains: ['mail'] }))
    registerItemAction(action({ id: 'docs', domains: ['documents'] }))
    registerItemAction(action({ id: 'both', domains: ['mail', 'documents'] }))

    expect(itemActionsFor('mail', context()).map(entry => entry.id)).toEqual(['both', 'mail'])
    expect(itemActionsFor('documents', context({ domain: 'documents' })).map(entry => entry.id)).toEqual(['both', 'docs'])
    expect(itemActionsFor('calendar', context())).toEqual([])
  })

  it('drops actions whose visible() says no', () => {
    const visible = vi.fn(() => false)
    registerItemAction(action({ id: 'hidden', visible }))
    registerItemAction(action({ id: 'shown' }))

    expect(itemActionsFor('mail', context()).map(entry => entry.id)).toEqual(['shown'])
    expect(visible).toHaveBeenCalledWith(expect.objectContaining({ domain: 'mail' }))
  })

  it('replaces an action registered again under the same id', () => {
    registerItemAction(action({ id: 'same', label: 'Old' }))
    registerItemAction(action({ id: 'same', label: 'New' }))

    expect(itemActionsFor('mail', context())).toMatchObject([{ label: 'New' }])
  })
})

describe('itemActionMenuItems', () => {
  it('resolves the targets and skips an action without one', () => {
    registerItemAction(action({ id: 'go', label: 'Go', to: ctx => ({ path: '/automation/new', query: { from: ctx.ref } }) }))
    registerItemAction(action({ id: 'skip', label: 'Skip', to: () => undefined }))

    expect(itemActionMenuItems('mail', context())).toEqual([[
      { label: 'Go', icon: 'i-lucide-star', to: { path: '/automation/new', query: { from: 'mail:mail-1:INBOX%2F1' } } }
    ]])
  })

  it('keeps the domain owned entries in front of the registered group', () => {
    registerItemAction(action({ id: 'go', label: 'Go' }))
    const own = [[{ label: 'Mark unread' }]]

    expect(itemActionMenuItems('mail', context(), own)).toEqual([own[0], [{ label: 'Go', icon: 'i-lucide-star', to: '/somewhere' }]])
  })

  it('is empty when no action applies', () => {
    expect(itemActionMenuItems('mail', context())).toEqual([])
  })
})
