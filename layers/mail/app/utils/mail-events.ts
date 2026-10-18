import type { DomainEvent } from '#layers/core/shared/types/domain-events'

export interface MailRefresh {
  /** Reload the list of the current service and mailbox */
  list: boolean
  /** Reload the folder counts of every account */
  folders: boolean
  /** Reload the search index status */
  indexStatus: boolean
}

/** Decides what a mail event refreshes for the mailbox the page is showing. */
export function mailRefreshFor(event: DomainEvent, current: { service: string, mailbox: string }): MailRefresh {
  if (event.domain !== 'mail') {
    return { list: false, folders: false, indexStatus: false }
  }

  return {
    list: event.type === 'changed'
      && event.service === current.service
      && (!event.resource || event.resource === current.mailbox),
    folders: event.type === 'changed',
    indexStatus: event.type === 'synced'
  }
}
