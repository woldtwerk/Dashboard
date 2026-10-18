import type { Relation } from '#layers/core/shared/types/entities'

export interface SplitRelatedEvents {
  /** Events at or after `now`, soonest first */
  upcoming: Relation[]
  /** Events before `now`, most recent first */
  past: Relation[]
}

const time = (relation: Relation): number => {
  const at = relation.item.at
  return at ? new Date(at).getTime() : Number.NaN
}

// Undated events come first, so the comparator never returns NaN
function compare(a: Relation, b: Relation, direction: 1 | -1): number {
  const first = time(a)
  const second = time(b)
  if (Number.isNaN(first)) {
    return -1
  }
  if (Number.isNaN(second)) {
    return 1
  }
  return direction * (first - second)
}

/** Related events split around `now`; an event without a date counts as upcoming. */
export function splitRelatedEvents(relations: Relation[], now: Date): SplitRelatedEvents {
  const upcoming: Relation[] = []
  const past: Relation[] = []

  for (const relation of relations) {
    const at = time(relation)
    if (Number.isNaN(at) || at >= now.getTime()) {
      upcoming.push(relation)
    } else {
      past.push(relation)
    }
  }

  upcoming.sort((a, b) => compare(a, b, 1))
  past.sort((a, b) => compare(a, b, -1))
  return { upcoming, past }
}
