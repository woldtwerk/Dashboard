import { describe, expect, it } from 'vitest'
import { contactGetSources, contactsSearchSources } from '../server/tools'

describe('contacts tool sources', () => {
  const contact = {
    uid: 'card-1',
    addressBook: 'book',
    service: 'contacts',
    name: 'Jane Doe',
    organization: 'Acme',
    emails: [{ value: 'jane@example.com' }],
    phones: [],
    addresses: []
  }

  it('maps a search result to a contact card', () => {
    expect(contactsSearchSources({ contacts: [contact] })).toEqual([{
      kind: 'contact',
      title: 'Jane Doe',
      subtitle: 'Acme',
      link: '/contacts?contact=card-1'
    }])
  })

  it('falls back to the first email for the title and subtitle', () => {
    const sources = contactsSearchSources({ contacts: [{ ...contact, name: '', organization: undefined }] })

    expect(sources[0]).toMatchObject({ title: 'jane@example.com', subtitle: 'jane@example.com' })
  })

  it('maps a read contact to one card and ignores an unknown output', () => {
    expect(contactGetSources(contact)).toHaveLength(1)
    expect(contactGetSources({ error: 'Contact not found' })).toEqual([])
    expect(contactsSearchSources(undefined)).toEqual([])
  })
})
