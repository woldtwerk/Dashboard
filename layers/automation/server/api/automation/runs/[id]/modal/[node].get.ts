import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import type { AppliedAction } from '../../../../../../shared/types/automation'
import { getRun } from '../../../../../utils/runs'

/**
 * The pop-up one `notify` action produced, for the modal a notification and a live
 * domain event point at. Only an applied run serves it; a modal with an expiry
 * answers 410 once that has passed. The text never leaves the server otherwise.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const node = getRouterParam(event, 'node')
  if (!id || !node) {
    throw createError({ status: 400, statusText: 'Missing run or node id' })
  }

  const run = await getRun(id)
  const action = run.applied.find(
    (candidate): candidate is Extract<AppliedAction, { type: 'notify' }> =>
      candidate.type === 'notify' && candidate.nodeId === node && !!candidate.modal
  )
  if (!action?.modal) {
    throw createError({ status: 404, statusText: 'This run has no notification modal here' })
  }

  if (action.modal.expiresAt && Date.parse(action.modal.expiresAt) < Date.now()) {
    throw createError({ status: 410, statusText: 'This notification has expired' })
  }

  return {
    title: action.modal.title,
    text: action.modal.text,
    copy: action.modal.copy,
    at: run.at
  }
})
