import { z } from 'zod'
import type { DomainTool, ToolSource } from '../../core/shared/types/tools'
import { entityLink } from '../../core/shared/entities'
import { matchContact } from '../../contacts/app/utils/contacts'
import type { Contact, ContactInput } from '../shared/types/contacts'

const emailInput = z.object({
  value: z.string().trim().min(1).max(500).describe('Email address'),
  label: z.string().trim().max(50).optional().describe('Label such as "work" or "home"')
})

const phoneInput = z.object({
  value: z.string().trim().min(1).max(500).describe('Phone number'),
  label: z.string().trim().max(50).optional().describe('Label such as "mobile"')
})

const addressInput = z.object({
  street: z.string().trim().max(500).optional().describe('Street and number'),
  city: z.string().trim().max(200).optional().describe('City'),
  region: z.string().trim().max(200).optional().describe('State or region'),
  postalCode: z.string().trim().max(50).optional().describe('Postal code'),
  country: z.string().trim().max(200).optional().describe('Country'),
  label: z.string().trim().max(50).optional().describe('Label such as "home"')
})

/** The editable contact fields, without the address book they live in. */
export const contactToolFields = {
  name: z.string().trim().max(500).optional().describe('Display name; overrides the name parts'),
  firstName: z.string().trim().max(200).optional().describe('First name'),
  lastName: z.string().trim().max(200).optional().describe('Last name'),
  emails: z.array(emailInput).max(50).default([]).describe('Email addresses'),
  phones: z.array(phoneInput).max(50).default([]).describe('Phone numbers'),
  addresses: z.array(addressInput).max(20).default([]).describe('Postal addresses'),
  organization: z.string().trim().max(500).optional().describe('Company or organisation'),
  jobTitle: z.string().trim().max(200).optional().describe('Job title'),
  birthday: z.string().trim().max(20).optional().describe('Birthday as YYYY-MM-DD'),
  notes: z.string().trim().max(20_000).optional().describe('Free-text notes'),
  photo: z.string().max(5_000_000).optional().describe('Photo as a data URI or URL')
}

async function serviceContacts(service: string, addressBook: string | undefined, q: string): Promise<Contact[]> {
  await ensureContactsSynced(service)
  const contacts = await cachedContacts(service, addressBook)

  return contacts
    .filter(contact => matchContact(contact, q))
    .map(contact => ({ ...contact, service }))
}

function contactSource(contact: Contact): ToolSource {
  const subtitle = contact.organization || contact.emails[0]?.value

  return {
    kind: 'contact',
    title: contact.name || contact.emails[0]?.value || '(no name)',
    ...(subtitle ? { subtitle } : {}),
    link: entityLink({ type: 'contact', service: contact.service, id: contact.uid })
  }
}

/** Source cards for `contacts_search`: one row per matching contact. */
export function contactsSearchSources(output: unknown): ToolSource[] {
  const contacts = (output as { contacts?: Contact[] } | undefined)?.contacts
  return Array.isArray(contacts) ? contacts.map(contactSource) : []
}

/** Source card for `contacts_get`: the one contact that was read. */
export function contactGetSources(output: unknown): ToolSource[] {
  const contact = output as Partial<Contact> | undefined
  return contact?.uid ? [contactSource(contact as Contact)] : []
}

export const contactsTools: DomainTool[] = [
  {
    name: 'contacts_search',
    domain: 'contacts',
    description: 'Search contacts by name, email, phone, organisation or notes. Returns matching contact cards across the configured address books.',
    input: z.object({
      q: z.string().trim().max(200).describe('Free-text search; an empty string returns every contact'),
      service: z.string().min(1).optional().describe('Contacts service id; omit to search every configured account'),
      addressBook: z.string().min(1).optional().describe('Address book URL from the contacts page; omit to search all of the service')
    }),
    writes: false,
    execute: async (raw) => {
      const input = raw as { q: string, service?: string, addressBook?: string }
      const services = input.service ? [input.service] : (await listServices('contacts')).map(item => item.id)
      const results: Contact[] = []

      for (const service of services) {
        try {
          results.push(...await serviceContacts(service, input.addressBook, input.q))
        } catch (error) {
          if (input.service) {
            throw error
          }
        }
      }

      return { contacts: results }
    },
    sources: contactsSearchSources
  },
  {
    name: 'contacts_get',
    domain: 'contacts',
    description: 'Read one contact card by its vCard UID. A UID is only unique within its address book, so pass `service` and `addressBook` when known.',
    input: z.object({
      uid: z.string().min(1).describe('vCard UID of the contact'),
      service: z.string().min(1).optional().describe('Contacts service id'),
      addressBook: z.string().min(1).optional().describe('Address book URL the contact is in')
    }),
    writes: false,
    execute: async (raw) => {
      const input = raw as { uid: string, service?: string, addressBook?: string }
      const services = input.service ? [input.service] : (await listServices('contacts')).map(item => item.id)

      for (const service of services) {
        const found = (await serviceContacts(service, input.addressBook, '')).find(contact => contact.uid === input.uid)
        if (found) {
          return found
        }
      }

      return { error: 'Contact not found' }
    },
    sources: contactGetSources
  },
  {
    name: 'contacts_create',
    domain: 'contacts',
    description: 'Create one contact card in an address book. Only `service` and `addressBook` identify where it goes; every other field is optional.',
    input: z.object({
      service: z.string().min(1).describe('Contacts service id'),
      addressBook: z.string().min(1).describe('Address book URL to create the card in'),
      ...contactToolFields
    }),
    writes: true,
    execute: async (raw) => {
      const input = raw as ContactInput & { service: string, addressBook: string }
      const created = await (await useContactsProvider(input.service)).createContact(input.addressBook, input)
      if (created.url) {
        await syncCachedCardAfterWrite(input.service, input.addressBook, created.url)
      }
      await publishDomainEvent({ domain: 'contacts', service: input.service, type: 'changed', resource: input.addressBook })

      return { ...created, service: input.service }
    }
  },
  {
    name: 'contacts_update',
    domain: 'contacts',
    description: 'Update a contact card. Pass the URL and ETag from contacts_get so a concurrent edit is detected; fields left out are cleared.',
    input: z.object({
      service: z.string().min(1).describe('Contacts service id'),
      addressBook: z.string().min(1).describe('Address book URL the contact is in'),
      uid: z.string().min(1).describe('vCard UID of the contact'),
      url: z.string().url().optional().describe('DAV object href from contacts_get'),
      etag: z.string().optional().describe('ETag from contacts_get'),
      ...contactToolFields
    }),
    writes: true,
    execute: async (raw) => {
      const input = raw as ContactInput & { service: string, addressBook: string, uid: string, url?: string, etag?: string }
      await (await useContactsProvider(input.service)).updateContact({
        uid: input.uid,
        addressBook: input.addressBook,
        url: input.url,
        etag: input.etag,
        name: input.name ?? ''
      } as Contact, input)
      if (input.url) {
        await syncCachedCardAfterWrite(input.service, input.addressBook, input.url)
      }
      await publishDomainEvent({ domain: 'contacts', service: input.service, type: 'changed', resource: input.addressBook })

      return { ok: true, uid: input.uid }
    }
  }
]
