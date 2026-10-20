import type { AutomationRun } from '../../shared/types/automation'
import { MODAL_EVENT_TYPE, modalEventResource } from '../../shared/extractors'
import { REVIEW_EVENT_RESOURCE, REVIEW_EVENT_TYPE } from '../../shared/events'
import { publishDomainEvent } from '../../../core/server/utils/domain-events'

/** Announces one workflow pop-up to every open tab */
export async function publishModalEvent(run: AutomationRun, nodeId: string): Promise<void> {
  await publishDomainEvent({
    domain: 'automation',
    service: run.service,
    type: MODAL_EVENT_TYPE,
    resource: modalEventResource(run.id, nodeId)
  })
}

/** Announces that a run started or stopped waiting for a human answer */
export async function publishReviewEvent(run: AutomationRun): Promise<void> {
  await publishDomainEvent({
    domain: 'automation',
    service: run.service,
    type: REVIEW_EVENT_TYPE,
    resource: REVIEW_EVENT_RESOURCE
  })
}

/**
 * The same review event for something that is not a run: a payment action that
 * could not confirm a mail and left the decision to the owner.
 */
export async function publishReviewNeeded(service: string): Promise<void> {
  await publishDomainEvent({
    domain: 'automation',
    service,
    type: REVIEW_EVENT_TYPE,
    resource: REVIEW_EVENT_RESOURCE
  })
}
