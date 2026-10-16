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
