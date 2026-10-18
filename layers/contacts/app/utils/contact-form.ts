import type { Contact, ContactInput } from '#layers/contacts/shared/types/contacts'

/** The editable fields of a contact, as the form holds them. */
export interface ContactFormModel {
  addressBook: string
  firstName: string
  lastName: string
  organization: string
  jobTitle: string
  birthday: string
  notes: string
  emails: { value: string, label: string }[]
  phones: { value: string, label: string }[]
  addresses: { street: string, city: string, country: string, label: string }[]
}

/** Split a display name into the first and last name the form edits separately. */
export function splitContactName(name: string): { firstName: string, lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') }
}

/** An empty form, optionally prefilled from a person an address is already known for. */
export function emptyContactForm(addressBook = '', prefill?: { name?: string, email?: string }): ContactFormModel {
  const { firstName, lastName } = splitContactName(prefill?.name ?? '')
  return {
    addressBook,
    firstName,
    lastName,
    organization: '',
    jobTitle: '',
    birthday: '',
    notes: '',
    emails: [{ value: prefill?.email ?? '', label: '' }],
    phones: [{ value: '', label: '' }],
    addresses: []
  }
}

/** The form filled from a stored contact. */
export function contactFormFromContact(contact: Contact): ContactFormModel {
  return {
    addressBook: contact.addressBook,
    firstName: contact.firstName ?? '',
    lastName: contact.lastName ?? '',
    organization: contact.organization ?? '',
    jobTitle: contact.jobTitle ?? '',
    birthday: contact.birthday ?? '',
    notes: contact.notes ?? '',
    emails: contact.emails.length ? contact.emails.map(email => ({ value: email.value, label: email.label ?? '' })) : [{ value: '', label: '' }],
    phones: contact.phones.length ? contact.phones.map(phone => ({ value: phone.value, label: phone.label ?? '' })) : [{ value: '', label: '' }],
    addresses: contact.addresses.map(address => ({
      street: address.street ?? '',
      city: address.city ?? '',
      country: address.country ?? '',
      label: address.label ?? ''
    }))
  }
}

/** The API input a form holds; empty rows and blank labels are dropped. */
export function contactFormToInput(form: ContactFormModel): ContactInput {
  return {
    firstName: form.firstName.trim() || undefined,
    lastName: form.lastName.trim() || undefined,
    organization: form.organization.trim() || undefined,
    jobTitle: form.jobTitle.trim() || undefined,
    birthday: form.birthday || undefined,
    notes: form.notes.trim() || undefined,
    emails: form.emails.filter(email => email.value.trim()).map(email => ({ value: email.value.trim(), label: email.label.trim() || undefined })),
    phones: form.phones.filter(phone => phone.value.trim()).map(phone => ({ value: phone.value.trim(), label: phone.label.trim() || undefined })),
    addresses: form.addresses.filter(address => address.street || address.city || address.country).map(address => ({
      street: address.street.trim() || undefined,
      city: address.city.trim() || undefined,
      country: address.country.trim() || undefined,
      label: address.label.trim() || undefined
    }))
  }
}

/** Everything a save needs: the fields to write and the address book to write them to. */
export interface ContactDraft {
  input: ContactInput
  addressBook: string
}

export function contactFormToDraft(form: ContactFormModel): ContactDraft {
  return { input: contactFormToInput(form), addressBook: form.addressBook }
}

/** Whether the form can be saved: an address book and a name to show. */
export function contactFormValid(form: ContactFormModel): boolean {
  return !!form.addressBook && !!(form.firstName.trim() || form.lastName.trim() || form.organization.trim())
}

/** The name shown in lists: the person, or the organisation when there is none. */
export function contactDisplayName(input: ContactInput): string {
  return input.firstName || input.lastName
    ? [input.firstName, input.lastName].filter(Boolean).join(' ')
    : input.organization || 'Unnamed'
}
