import type { DomainEvent } from '#layers/core/shared/types/domain-events'

export interface MailRefresh {
  /** Reload the list of the current service and mailbox */
  list: boolean
  /** Reload the folder counts of every account */
  folders: boolean
  /** Reload the search index status */
  indexStatus: boolean
}

export interface MailRefreshCurrent {
  /** The account the page is showing */
  service: string
  /** The folder the page is showing; irrelevant when `allFolders` is set */
  mailbox: string
  /** Whether the list spans every folder of the account */
  allFolders?: boolean
}

/** Decides what a mail event refreshes for the view the page is showing. */
export function mailRefreshFor(event: DomainEvent, current: MailRefreshCurrent): MailRefresh {
  if (event.domain !== 'mail') {
    return { list: false, folders: false, indexStatus: false }
  }

  return {
    // With all folders on screen, a change in any of them changes the list; a
    // single folder only reloads for its own changes.
    list: event.type === 'changed'
      && event.service === current.service
      && (current.allFolders || !event.resource || event.resource === current.mailbox),
    folders: event.type === 'changed',
    // A finished sync and every folder it completes move the index progress
    indexStatus: event.type === 'synced' || event.type === 'changed'
  }
}
