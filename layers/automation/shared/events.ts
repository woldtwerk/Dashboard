/**
 * The automation domain events other than a workflow pop-up.
 *
 * The type says what happened; the resource is stable and cannot be mistaken for
 * a modal reference, so a consumer only reacts to the events it handles.
 */

/** A run started or stopped waiting for a human answer */
export const REVIEW_EVENT_TYPE = 'review'

/** The resource every review event carries; never mistaken for a modal reference */
export const REVIEW_EVENT_RESOURCE = 'runs:review'

/** Whether an event can move the number of runs waiting for a review */
export function isReviewEvent(type: string): boolean {
  return type === REVIEW_EVENT_TYPE
}
