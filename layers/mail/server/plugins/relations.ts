import { entityLink, normalizeEmail } from '../../../core/shared/entities'
import type { EntityRef, Relation, RelationKind } from '../../../core/shared/types/entities'
import { registerRelationProvider } from '../../../core/server/utils/relations'
import type { MailAddress, MailSummary } from '../../shared/types/mail'
import { mailAddressLabel, mailAddressText, mailRelationKind } from '../utils/mail-relations'

const WEIGHTS: Record<RelationKind, number> = {
  from: 1,
  to: 1,
  cc: 1,
  attendee: 1,
  organizer: 1,
  contact: 1,
  correspondent: 1,
  mentions: 0.5,
  attachment: 1,
  shared: 1
}

const FROM_PRIORITY: Record<string, number> = { from: 3, to: 2, cc: 1 }

function mailRef(service: string, mailbox: string, uid: number): EntityRef {
  return { type: 'mail', service, id: `${mailbox}/${uid}` }
}

function mailItem(hit: MailSummary) {
  return {
    ref: mailRef(hit.service!, hit.mailbox, hit.uid),
    title: hit.subject || '(no subject)',
    subtitle: mailAddressText(hit.from),
    at: hit.date,
    to: entityLink(mailRef(hit.service!, hit.mailbox, hit.uid)),
    icon: 'i-lucide-mail'
  }
}

function personRef(email: string): EntityRef {
  return { type: 'person', id: email }
}

/** The newest mail carrying the address, so `person` shows the name it is sent under */
async function knownPerson(email: string): Promise<{ name?: string, emails: string[] } | undefined> {
  const index = useMailSearchIndex()
  if (!index) {
    return undefined
  }

  const services = (await listServices('mail')).map(service => service.id)
  if (!services.length) {
    return undefined
  }

  const [newest] = await index.search({ services, participant: email, search: {}, limit: 1 })
  if (!newest) {
    return undefined
  }

  const address = [...newest.from, ...(newest.to ?? []), ...(newest.cc ?? [])]
    .find(candidate => normalizeEmail(candidate.address) === email)

  return { name: address?.name?.trim() || undefined, emails: [email] }
}

async function relatedToPerson(email: string, limit: number): Promise<Relation[]> {
  const index = useMailSearchIndex()
  if (!index) {
    // Without an index a participant search would fan out over every mailbox; leave it out
    return []
  }

  const services = (await listServices('mail')).map(service => service.id)
  if (!services.length) {
    return []
  }

  // One extra hit tells the registry whether there are more than it shows
  const hits = await index.search({ services, participant: email, search: {}, limit: limit + 1 })
  const relations: Relation[] = []

  for (const hit of hits) {
    if (!hit.service) {
      continue
    }

    const kind = mailRelationKind(hit, email)
    if (!kind) {
      continue
    }

    const item = mailItem(hit)
    relations.push({ kind, weight: WEIGHTS[kind], item })

    if (hit.hasAttachment) {
      relations.push({ kind: 'attachment', weight: WEIGHTS.attachment, item })
    }
  }

  return relations
}

/** Splits `<mailbox>/<uid>`; the mailbox itself may contain slashes */
function splitMailId(id: string): { mailbox: string, uid: number } | undefined {
  const at = id.lastIndexOf('/')
  const uid = Number(id.slice(at + 1))
  return at < 0 || !Number.isInteger(uid) ? undefined : { mailbox: id.slice(0, at), uid }
}

async function relatedToMail(ref: EntityRef, limit: number): Promise<Relation[]> {
  if (!ref.service) {
    return []
  }

  const parts = splitMailId(ref.id)
  if (!parts) {
    return []
  }

  const message = await (await useMailProvider(ref.service)).getMessage(parts.mailbox, parts.uid)
  if (!message) {
    return []
  }

  const people = new Map<string, { address: MailAddress, kind: RelationKind }>()
  for (const [kind, addresses] of [['from', message.from], ['to', message.to], ['cc', message.cc]] as const) {
    for (const address of addresses) {
      const email = normalizeEmail(address.address)
      if (!email) {
        continue
      }

      const known = people.get(email)
      if (!known || FROM_PRIORITY[kind]! > FROM_PRIORITY[known.kind]!) {
        people.set(email, { address, kind })
      }
    }
  }

  return [...people].slice(0, Math.max(0, limit) + 1).map(([email, { address, kind }]) => ({
    kind,
    weight: WEIGHTS[kind],
    item: {
      ref: personRef(email),
      title: mailAddressLabel(address, email),
      subtitle: address.name?.trim() ? email : undefined,
      at: message.date,
      to: entityLink(personRef(email)),
      icon: 'i-lucide-user'
    }
  }))
}

export default defineNitroPlugin(() => {
  registerRelationProvider('mail', {
    label: 'Mail',
    related(ref, { limit }) {
      return ref.type === 'person'
        ? relatedToPerson(normalizeEmail(ref.id) ?? ref.id, limit)
        : ref.type === 'mail' ? relatedToMail(ref, limit) : Promise.resolve([])
    },
    person: knownPerson
  })
})
