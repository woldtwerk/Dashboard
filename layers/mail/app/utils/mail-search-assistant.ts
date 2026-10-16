import type { MailSearch } from '#layers/mail/shared/types/mail'
import type { ServiceInfo } from '#layers/core/shared/types/setup'

/** Turns a free-text request into search criteria, e.g. with a language model */
export interface MailSearchAssistant {
  label: string
  icon: string
  /** Whether it can run with the configured services */
  isAvailable: (services: ServiceInfo[]) => boolean
  toSearch: (text: string) => Promise<MailSearch>
}

let assistant: MailSearchAssistant | undefined

/** Register from a plugin of another layer (e.g. mail-ai); the mail page then offers it in the search field */
export function defineMailSearchAssistant(definition: MailSearchAssistant) {
  assistant = definition
}

export function getMailSearchAssistant(): MailSearchAssistant | undefined {
  return assistant
}
