import type { MailSearch } from '../../../mail/shared/types/mail'
import type { AssistantMailSource } from '../../shared/types/assistant'
import type { AssistantMailAccess } from './assistant'
import { formatAddresses, mailLink, MAX_MAIL_TEXT, toMailSource } from './assistant'

/** Assistant data access: the search index where available, otherwise each provider's inbox */
export function createMailAccess(): AssistantMailAccess {
  return {
    async search(search: MailSearch, limit: number): Promise<AssistantMailSource[]> {
      const services = await listServices('mail')
      const index = useMailSearchIndex()
      const indexed: string[] = []
      const fromServers: AssistantMailSource[] = []

      for (const service of services) {
        if (index && await isMailboxIndexed(service.id)) {
          indexed.push(service.id)
          continue
        }
        // Not (fully) indexed yet: ask the mail server, inbox only
        try {
          const mails = await (await useMailProvider(service.id)).listMessages('INBOX', { limit, search })
          fromServers.push(...mails.map(mail => toMailSource(service.id, mail)))
        } catch (error) {
          console.warn(`[mail-ai] Search in ${service.name} failed:`, error)
        }
      }

      // Index hits are ranked by relevance; server results only by date, so they come after
      const ranked = index && indexed.length
        ? (await index.search({ services: indexed, search, limit })).map(mail => toMailSource(mail.service!, mail))
        : []

      return [...ranked, ...fromServers.sort((a, b) => b.date.localeCompare(a.date))].slice(0, limit)
    },

    async read(service, mailbox, uid) {
      const message = await (await useMailProvider(service)).getMessage(mailbox, uid)
      if (!message) {
        return null
      }

      return {
        subject: message.subject,
        from: formatAddresses(message.from),
        to: formatAddresses([...message.to, ...message.cc]),
        date: message.date,
        text: (message.text ?? '').slice(0, MAX_MAIL_TEXT),
        link: mailLink(service, mailbox, uid)
      }
    }
  }
}
