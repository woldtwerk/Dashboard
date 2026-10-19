import type { Component } from 'vue'
import type { DecisionFallback } from '../../shared/types/automation'

/**
 * A kind of fallback the builder can offer for an unsure decision, e.g. a human
 * check. The automation layer registers `human`; a layer that can answer with an AI
 * model registers `ai` and ships the editor that picks the model, so the inspector
 * never imports that layer.
 */
export interface DecisionFallbackType {
  type: DecisionFallback['type']
  /** Full name in the "Add fallback" menu and the chain's list */
  label: string
  /** Short name in the node's chain line, e.g. `AI → Human` */
  chainLabel?: string
  icon: string
  description?: string
  /** The control that edits this entry; absent when the entry has nothing to set */
  editor?: Component
}

const types = new Map<string, DecisionFallbackType>()

/** Called by a layer's plugin; a re-registration replaces the earlier entry */
export function registerDecisionFallback(entry: DecisionFallbackType) {
  types.set(entry.type, entry)
}

/** Test hook; a client render registers its fallbacks once at startup */
export function resetDecisionFallbacks() {
  types.clear()
}

/** The registered kinds, in registration order */
export function decisionFallbackTypes(): DecisionFallbackType[] {
  return [...types.values()]
}

export function decisionFallbackType(type: DecisionFallback['type']): DecisionFallbackType | undefined {
  return types.get(type)
}

/** The name shown for one entry, falling back to the raw type */
export function decisionFallbackLabel(type: DecisionFallback['type']): string {
  return types.get(type)?.label ?? type
}

/** A fresh entry of one kind */
export function createDecisionFallback(type: DecisionFallback['type']): DecisionFallback {
  return type === 'ai' ? { type: 'ai', model: '' } : { type: 'human' }
}

/** Appends one fallback; a human check is always last, so one already there is kept at the end */
export function addFallback(fallbacks: DecisionFallback[] | undefined, type: DecisionFallback['type']): DecisionFallback[] {
  const list = [...(fallbacks ?? [])]
  if (type === 'human' && list.some(fallback => fallback.type === 'human')) {
    return list
  }
  return [...list, createDecisionFallback(type)]
}

export function removeFallback(fallbacks: DecisionFallback[] | undefined, index: number): DecisionFallback[] {
  return [...(fallbacks ?? [])].filter((_, position) => position !== index)
}

/**
 * Swaps one entry with its neighbour. The chain may not move a human check away
 * from the end, so a move that would do that is ignored.
 */
export function moveFallback(fallbacks: DecisionFallback[] | undefined, index: number, delta: -1 | 1): DecisionFallback[] {
  const list = [...(fallbacks ?? [])]
  const target = index + delta
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) {
    return list
  }

  const moved = list[index]!
  const swapped = list[target]!
  if (moved.type === 'human' && target < list.length - 1) {
    return list
  }
  if (swapped.type === 'human' && index < list.length - 1) {
    return list
  }

  list[index] = swapped
  list[target] = moved
  return list
}

/** The chain as the node shows it, e.g. `AI → Human`; empty without fallbacks */
export function fallbackChainLabel(fallbacks: DecisionFallback[] | undefined): string {
  return (fallbacks ?? [])
    .map((fallback) => {
      const entry = types.get(fallback.type)
      return entry?.chainLabel ?? entry?.label ?? fallback.type
    })
    .join(' → ')
}
