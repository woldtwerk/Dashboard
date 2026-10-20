import { randomUUID } from 'node:crypto'
import { createError } from 'nuxt/server'
import { createDAVClient } from 'tsdav'
import type { DAVAddressBook } from 'tsdav'
import type { SetupValues } from '../../../core/shared/types/setup'
import { isUrlWithin, sameOrigin, sameResolvedUrl, sameUrl } from '../../../core/server/utils/url'
import type { AddressBook, Contact, ContactInput } from '../../shared/types/contacts'
import { parseVCard, patchVCard, readVCardUid, serializeVCard } from './vcard'

type DavClient = Awaited<ReturnType<typeof createDAVClient>>

interface DavSettings {
  url: string
  username: string
  password: string
}

function toDavSettings(values: SetupValues): DavSettings {
  return {
    url: String(values.url ?? '').replace(/\/+$/, ''),
    username: String(values.username ?? ''),
    password: String(values.password ?? '')
  }
}

/** An address book with the collection state the sync diffs against. */
export interface RemoteAddressBook extends AddressBook {
  ctag?: string
  syncToken?: string
}

/** One card as the sync sees it; `data` is the raw vCard. */
export interface RemoteCard {
  url: string
  etag?: string
  data: string
}

/** Port a contacts adapter implements; the generic CardDAV one is below. */
export interface ContactsProvider {
  listAddressBooks(): Promise<RemoteAddressBook[]>
  fetchCards(addressBookUrl: string): Promise<RemoteCard[]>
  /** The single card at that URL; used after a write and by the update check */
  fetchCard(addressBookUrl: string, url: string): Promise<RemoteCard | undefined>
  createContact(addressBookUrl: string, input: ContactInput): Promise<Contact>
  updateContact(contact: Contact, input: ContactInput): Promise<void>
  deleteContact(contact: Contact): Promise<void>
}

async function createClient(settings: DavSettings): Promise<DavClient> {
  if (!settings.url || !settings.username || !settings.password) {
    throw createError({ status: 503, statusText: 'CardDAV credentials are missing' })
  }

  try {
    return await createDAVClient({
      serverUrl: settings.url,
      credentials: { username: settings.username, password: settings.password },
      authMethod: 'Basic',
      defaultAccountType: 'carddav'
    })
  } catch (error) {
    throw createError({ status: 502, statusText: 'Could not reach the CardDAV server', cause: error })
  }
}

function toText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value || undefined
  }
  if (value && typeof value === 'object' && '#text' in value) {
    return String((value as { '#text': unknown })['#text'])
  }
  return undefined
}

function toAddressBook(collection: DAVAddressBook): RemoteAddressBook {
  return {
    url: collection.url,
    name: toText(collection.displayName) ?? collection.url.split('/').filter(Boolean).at(-1) ?? 'Contacts',
    description: toText(collection.description),
    ctag: toText(collection.ctag),
    syncToken: toText(collection.syncToken)
  }
}

/** tsdav returns the card data and etag together; a card without data is skipped. */
function toRemoteCard(card: { url: string, etag?: string, data?: unknown }): RemoteCard | undefined {
  if (card.data === undefined || card.data === null || card.data === '') {
    return undefined
  }

  return { url: card.url, etag: card.etag, data: String(card.data) }
}

function checkResponse(response: Response, action: string): void {
  if (response.ok) {
    return
  }
  const status = response.status === 412 ? 409 : 502
  throw createError({ status, statusText: `Could not ${action} (${response.status})` })
}

function objectName(uid: string): string {
  return `${uid.replace(/[^A-Za-z0-9._@-]/g, '_')}.vcf`
}

function displayName(input: ContactInput): string {
  return input.name || [input.firstName, input.lastName].filter(Boolean).join(' ') || 'Unnamed'
}

export function createCardDavProvider(values: SetupValues): ContactsProvider {
  const settings = toDavSettings(values)

  // One discovery and one collection listing per provider, which the API
  // creates once per service per request; requests never share them.
  let connecting: Promise<DavClient> | undefined
  let listing: Promise<DAVAddressBook[]> | undefined

  const connect = () => (connecting ??= createClient(settings))
  const addressBookList = () => (listing ??= connect().then(client => client.fetchAddressBooks()))

  async function resolve(addressBookUrl: string): Promise<DAVAddressBook> {
    const found = (await addressBookList()).find(collection => sameUrl(collection.url, addressBookUrl))
    if (!found) {
      throw createError({ status: 404, statusText: 'Address book not found' })
    }
    return found
  }

  /** See the calendar provider: a client URL is only used once it is proven local. */
  function trustedObjectUrl(addressBook: DAVAddressBook, url: string | undefined): string {
    if (!url || !sameOrigin(settings.url, url) || !isUrlWithin(addressBook.url, url)) {
      throw createError({ status: 400, statusText: 'The contact URL is not part of this address book' })
    }
    return url
  }

  /**
   * The card the URL names, and only that one. A server that ignores the
   * multiget filter returns other cards too; taking the first of them would
   * let the edit overwrite an unrelated contact, so a miss is a 404.
   */
  async function cardAt(client: DavClient, addressBook: DAVAddressBook, url: string): Promise<RemoteCard | undefined> {
    const cards = await client.fetchVCards({ addressBook, objectUrls: [url], urlFilter: () => true })
    const card = cards.find(item => sameResolvedUrl(addressBook.url, url, item.url))

    return card ? toRemoteCard(card) : undefined
  }

  async function fetchCardForUpdate(client: DavClient, addressBook: DAVAddressBook, url: string, expectedUid: string): Promise<RemoteCard> {
    const card = await cardAt(client, addressBook, url)
    if (!card) {
      throw createError({ status: 404, statusText: 'Contact not found' })
    }

    // A card without a UID is identified by its object URL, which the match above already checked
    const uid = readVCardUid(card.data)
    if (uid !== undefined && uid !== expectedUid) {
      throw createError({ status: 409, statusText: 'The contact at that URL is not the expected one' })
    }

    return card
  }

  return {
    async listAddressBooks() {
      return (await addressBookList()).map(toAddressBook)
    },

    async fetchCards(addressBookUrl) {
      const client = await connect()
      const addressBook = await resolve(addressBookUrl)
      const cards = await client.fetchVCards({ addressBook, urlFilter: () => true })

      return cards.flatMap((card) => {
        const remote = toRemoteCard(card)
        return remote ? [remote] : []
      })
    },

    async fetchCard(addressBookUrl, url) {
      const client = await connect()
      const addressBook = await resolve(addressBookUrl)
      const trusted = trustedObjectUrl(addressBook, url)

      return cardAt(client, addressBook, trusted)
    },

    async createContact(addressBookUrl, input) {
      const client = await connect()
      const addressBook = await resolve(addressBookUrl)
      const uid = `${randomUUID()}@allmight`

      const response = await client.createVCard({ addressBook, vCardString: serializeVCard(input, uid, displayName(input)), filename: objectName(uid) })
      checkResponse(response, 'create the contact')

      return {
        ...parseVCard(serializeVCard(input, uid, displayName(input))),
        uid,
        url: `${addressBook.url.replace(/\/+$/, '')}/${objectName(uid)}`,
        addressBook: addressBook.url
      }
    },

    async updateContact(contact, input) {
      const client = await connect()
      const addressBook = await resolve(contact.addressBook)
      const url = trustedObjectUrl(addressBook, contact.url)
      const existing = await fetchCardForUpdate(client, addressBook, url, contact.uid)
      const data = patchVCard(existing.data, input, displayName(input))

      const response = await client.updateVCard({
        vCard: { url, etag: existing.etag ?? contact.etag, data }
      })
      checkResponse(response, 'update the contact')
    },

    async deleteContact(contact) {
      const client = await connect()
      const addressBook = await resolve(contact.addressBook)
      const url = trustedObjectUrl(addressBook, contact.url)

      const response = await client.deleteVCard({ vCard: { url, etag: contact.etag } })
      if (!response.ok && response.status !== 404) {
        checkResponse(response, 'delete the contact')
      }
    }
  }
}

/** Opens a CardDAV connection and lists address books, to verify stored credentials. */
export async function testCardDavConnection(values: SetupValues): Promise<void> {
  const provider = createCardDavProvider(values)
  await provider.listAddressBooks()
}

/** Creates a provider for one configured contacts service. */
export async function useContactsProvider(serviceId: string): Promise<ContactsProvider> {
  const service = await getService(serviceId, 'contacts')

  return createCardDavProvider(service.values)
}
