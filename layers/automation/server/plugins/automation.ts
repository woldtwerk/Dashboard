import { AUTOMATION_INBOX } from '../utils/automation-items'
import type { AutomationDomain } from '../../shared/types/automation'

/** The message of an error or of the error it wraps; the objects themselves never reach the log */
function errorText(error: unknown): string | undefined {
  if (error === undefined || error === null) {
    return undefined
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * Automation listens to the domain event stream: new mail arriving in the inbox and
 * new documents in the archive's inbox are evaluated by the rules. The work runs
 * under a per-service lock, so several cluster workers never evaluate the same item
 * twice; a failure is logged and never fails the sync that produced the event.
 */
export default defineNitroPlugin(() => {
  registerNotificationCategory({
    id: 'automation',
    domain: 'automation',
    label: 'Automation',
    description: 'A rule suggests an action for new mail or a new document.',
    defaultStyle: 'in-app'
  })

  registerNotificationCategory({
    id: 'automation-notify',
    domain: 'automation',
    label: 'Workflow notifications',
    description: 'A workflow sends a notification, optionally with a pop-up.',
    defaultStyle: 'both'
  })

  useDomainEventBus().subscribe((event) => {
    if (event.type !== 'changed') {
      return
    }

    if (event.domain === 'mail') {
      // Only the inbox feeds mail rules; a flag change elsewhere is not new mail
      if (event.resource !== AUTOMATION_INBOX) {
        return
      }
    } else if (event.domain !== 'documents') {
      return
    }

    runAutomation(event.domain as AutomationDomain, event.service).catch((error) => {
      useServiceLogger('automation', event.service).error('Automation run failed', {
        error: errorText(error),
        // A provider wraps the actual reason (IMAP code, TLS refusal) as `cause`
        cause: errorText((error as { cause?: unknown } | undefined)?.cause)
      })
    })
  })
})
