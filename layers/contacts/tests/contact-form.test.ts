import { describe, expect, it } from 'vitest'
import type { Contact } from '../shared/types/contacts'
import { contactDisplayName, contactFormFromContact, contactFormToInput, contactFormValid, emptyContactForm, splitContactName } from '../app/utils/contact-form'

describe('splitContactName', () => {
  it('splits the first token from the rest', () => {
    expect(splitContactName('Jane Doe')).toEqual({ firstName: 'Jane', lastName: 'Doe' })
    expect(splitContactName('Jane van Doe')).toEqual({ firstName: 'Jane', lastName: 'van Doe' })
  })

  it('handles a single name or nothing', () => {
    expect(splitContactName('Jane')).toEqual({ firstName: 'Jane', lastName: '' })
    expect(splitContactName('  ')).toEqual({ firstName: '', lastName: '' })
  })
})

describe('emptyContactForm', () => {
  it('prefills the name and email of a known person', () => {
    const form = emptyContactForm('book', { name: 'Jane Doe', email: 'jane@example.com' })

    expect(form.addressBook).toBe('book')
    expect(form.firstName).toBe('Jane')
    expect(form.lastName).toBe('Doe')
    expect(form.emails).toEqual([{ value: 'jane@example.com', label: '' }])
  })

  it('starts with one empty email and phone row', () => {
    const form = emptyContactForm()
    expect(form.emails).toEqual([{ value: '', label: '' }])
    expect(form.phones).toEqual([{ value: '', label: '' }])
  })
})

describe('contactFormFromContact', () => {
  const contact: Contact = {
    uid: 'c1',
    addressBook: 'book',
    name: 'Jane Doe',
    firstName: 'Jane',
    emails: [{ value: 'jane@example.com' }],
    phones: [],
    addresses: [{ street: 'Main St', country: 'DE' }]
  }

  it('fills the form from a stored contact', () => {
    const form = contactFormFromContact(contact)
    expect(form.firstName).toBe('Jane')
    expect(form.emails).toEqual([{ value: 'jane@example.com', label: '' }])
    expect(form.addresses).toEqual([{ street: 'Main St', city: '', country: 'DE', label: '' }])
  })

  it('keeps one blank row for an empty list, so the form has a field', () => {
    expect(contactFormFromContact(contact).phones).toEqual([{ value: '', label: '' }])
  })
})

describe('contactFormToInput', () => {
  it('drops empty rows, blank labels and blank fields', () => {
    const form = emptyContactForm('book', { name: 'Jane Doe', email: ' jane@example.com ' })
    form.phones = [{ value: '', label: '' }, { value: '123', label: ' mobile ' }]
    form.addresses = [{ street: '', city: '', country: '', label: '' }, { street: 'Main St', city: '', country: '', label: '' }]

    expect(contactFormToInput(form)).toEqual({
      firstName: 'Jane',
      lastName: 'Doe',
      emails: [{ value: 'jane@example.com', label: undefined }],
      phones: [{ value: '123', label: 'mobile' }],
      addresses: [{ street: 'Main St', city: undefined, country: undefined, label: undefined }]
    })
  })
})

describe('contactFormValid', () => {
  it('needs an address book and something to call the contact', () => {
    expect(contactFormValid(emptyContactForm('book', { name: 'Jane' }))).toBe(true)
    expect(contactFormValid(emptyContactForm('book'))).toBe(false)
    expect(contactFormValid({ ...emptyContactForm('', { name: 'Jane' }) })).toBe(false)
  })

  it('accepts an organisation without a person name', () => {
    const form = emptyContactForm('book')
    form.organization = 'ACME'
    expect(contactFormValid(form)).toBe(true)
  })
})

describe('contactDisplayName', () => {
  it('joins the name parts, falling back to the organisation', () => {
    expect(contactDisplayName({ firstName: 'Jane', lastName: 'Doe', emails: [], phones: [], addresses: [] })).toBe('Jane Doe')
    expect(contactDisplayName({ organization: 'ACME', emails: [], phones: [], addresses: [] })).toBe('ACME')
    expect(contactDisplayName({ emails: [], phones: [], addresses: [] })).toBe('Unnamed')
  })
})
