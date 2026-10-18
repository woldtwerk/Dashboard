/** Settings section `assistant` */
export interface AssistantSettings {
  /** Domains whose read tools the assistant may use; every enabled domain's data reaches the AI provider */
  domains: string[]
}

/** One domain the assistant can read, as listed in the settings and by `GET /api/mail/ai/domains`. */
export interface AssistantDomainInfo {
  domain: string
  label: string
  /** Read tools the domain registers; write tools are never offered to the assistant */
  toolCount: number
}

/** A mail the assistant found, as shown with its answer */
export interface AssistantMailSource {
  service: string
  mailbox: string
  uid: number
  subject: string
  from: string
  date: string
  unread: boolean
  snippet?: string
  /** Opens the mail on the mail page */
  link: string
}
