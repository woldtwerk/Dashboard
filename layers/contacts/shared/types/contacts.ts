export interface ContactEmail {
  value: string
  label?: string
}

export interface ContactPhone {
  value: string
  label?: string
}

export interface ContactAddress {
  street?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
  label?: string
}

/** A contact as the API and UI use it; a flattened, common subset of vCard. */
export interface Contact {
  /** vCard UID */
  uid: string
  /** DAV object href; needed to update or delete */
  url?: string
  etag?: string
  /** DAV collection URL of the address book */
  addressBook: string
  /** Service that owns the address book; set when results span services */
  service?: string
  name: string
  firstName?: string
  lastName?: string
  emails: ContactEmail[]
  phones: ContactPhone[]
  addresses: ContactAddress[]
  organization?: string
  jobTitle?: string
  /** ISO date (YYYY-MM-DD) */
  birthday?: string
  notes?: string
  /** Data URI or URL */
  photo?: string
}

/** The editable fields of a contact. */
export interface ContactInput {
  firstName?: string
  lastName?: string
  /** Overrides the name derived from the name parts */
  name?: string
  emails: ContactEmail[]
  phones: ContactPhone[]
  addresses: ContactAddress[]
  organization?: string
  jobTitle?: string
  birthday?: string
  notes?: string
  photo?: string
}

/** An address book collection on a CardDAV server. */
export interface AddressBook {
  url: string
  name: string
  description?: string
  service?: string
  serviceName?: string
  icon?: string
}

/** Address books of one service, or its error */
export interface ContactList {
  service: { id: string, name: string, icon?: string }
  addressBooks: AddressBook[]
  error?: string
}
