import { describe, expect, it } from 'vitest'
import type { Contact } from '../shared/types/contacts'
import { contactInitial, contactSubtitle, groupContacts, matchContact, sortName } from '../app/utils/contacts'

const contact = (overrides: Partial<Contact>): Contact => ({
  uid: 'x',
  addressBook: 'book',
  name: 'x',
  emails: [],
  phones: [],
  addresses: [],
  ...overrides
})

describe('sortName', () => {
  it('prefers the person, then the organization', () => {
    expect(sortName(contact({ name: 'Ignored', firstName: 'Ada', lastName: 'Lovelace' }))).toBe('Lovelace Ada')
    expect(sortName(contact({ name: 'Acme', organization: 'Acme GmbH' }))).toBe('Acme GmbH')
    expect(sortName(contact({ name: 'Just A Name' }))).toBe('Just A Name')
  })
})

describe('contactInitial', () => {
  it('buckets Latin letters and sends the rest to #', () => {
    expect(contactInitial(contact({ name: 'Ada' }))).toBe('A')
    expect(contactInitial(contact({ name: 'övrig' }))).toBe('#')
    expect(contactInitial(contact({ name: '3Com' }))).toBe('#')
  })
})

describe('groupContacts', () => {
  it('groups by initial, sorts within, and puts # last', () => {
    const groups = groupContacts([
      contact({ uid: '1', name: 'Zoe' }),
      contact({ uid: '2', name: 'Adam' }),
      contact({ uid: '3', name: '3Com' }),
      contact({ uid: '4', name: 'Alice' })
    ])

    expect(groups.map(group => group.letter)).toEqual(['A', 'Z', '#'])
    expect(groups[0]!.contacts.map(item => item.name)).toEqual(['Adam', 'Alice'])
  })
})

describe('matchContact', () => {
  const ada = contact({
    name: 'Ada Lovelace',
    organization: 'Analytical Engines',
    emails: [{ value: 'ada@example.com' }],
    phones: [{ value: '+49 123 456' }],
    notes: 'First programmer'
  })

  it('matches names, org, mail, phone and notes, case-insensitively', () => {
    expect(matchContact(ada, 'lovelace')).toBe(true)
    expect(matchContact(ada, 'ANALYTICAL')).toBe(true)
    expect(matchContact(ada, 'example.com')).toBe(true)
    expect(matchContact(ada, '123')).toBe(true)
    expect(matchContact(ada, 'programmer')).toBe(true)
    expect(matchContact(ada, 'grace')).toBe(false)
  })

  it('matches everything on an empty query', () => {
    expect(matchContact(ada, '  ')).toBe(true)
  })
})

describe('contactSubtitle', () => {
  it('joins the organization and title, falling back to contact details', () => {
    expect(contactSubtitle(contact({ name: 'x', organization: 'Acme', jobTitle: 'CEO' }))).toBe('Acme · CEO')
    expect(contactSubtitle(contact({ name: 'x', emails: [{ value: 'a@b.c' }] }))).toBe('a@b.c')
    expect(contactSubtitle(contact({ name: 'x', phones: [{ value: '+1' }] }))).toBe('+1')
  })
})
