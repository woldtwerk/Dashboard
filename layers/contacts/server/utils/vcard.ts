import type { Contact, ContactAddress, ContactInput } from '../../shared/types/contacts'

interface VCardProperty {
  name: string
  params: Record<string, string[]>
  value: string
}

/** Unfold a folded vCard: a line starting with a space or tab continues the previous one. */
function unfold(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const unfolded: string[] = []

  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1)
    } else if (line.trim()) {
      unfolded.push(line)
    }
  }

  return unfolded
}

function indexOfUnescaped(value: string, separator: string): number {
  let escaped = false

  for (let index = 0; index < value.length; index++) {
    const char = value[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === separator) {
      return index
    }
  }

  return -1
}

function splitUnescaped(value: string, separator: string): string[] {
  const parts: string[] = []
  let current = ''
  let escaped = false

  for (const char of value) {
    if (escaped) {
      current += char
      escaped = false
    } else if (char === '\\') {
      current += char
      escaped = true
    } else if (char === separator) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }

  parts.push(current)

  return parts
}

function unescapeValue(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char))
}

function parseLine(line: string): VCardProperty | undefined {
  const colon = indexOfUnescaped(line, ':')
  if (colon < 0) {
    return undefined
  }

  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const segments = splitUnescaped(head, ';')

  let name = segments[0]!
  const dot = name.indexOf('.')
  if (dot >= 0) {
    // `item1.EMAIL` — the group is not part of the property name
    name = name.slice(dot + 1)
  }
  name = name.toUpperCase()

  const params: Record<string, string[]> = {}
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf('=')
    if (eq < 0) {
      params.TYPE = [...params.TYPE ?? [], segment.toUpperCase()]
      continue
    }
    const key = segment.slice(0, eq).toUpperCase()
    params[key] = [...params[key] ?? [], ...splitUnescaped(segment.slice(eq + 1), ',').map(part => part.toUpperCase())]
  }

  return { name, params, value }
}

function parseProperties(text: string): VCardProperty[] {
  return unfold(text)
    .map(parseLine)
    .filter((property): property is VCardProperty => !!property && property.name !== 'BEGIN' && property.name !== 'END' && property.name !== 'VERSION')
}

function typeLabel(property: VCardProperty): string | undefined {
  const type = property.params.TYPE?.[0]
  return type ? type.toLowerCase() : undefined
}

function normalizedBirthday(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined
  }
  const digits = /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
  return digits ? `${digits[1]}-${digits[2]}-${digits[3]}` : raw
}

function photoValue(property: VCardProperty | undefined): string | undefined {
  if (!property) {
    return undefined
  }
  if (/^(https?:|data:)/i.test(property.value)) {
    return property.value
  }
  // A bare base64 body; assume JPEG, which is what most vCards carry
  return `data:image/jpeg;base64,${property.value.replace(/\s/g, '')}`
}

/** The UID stored in a vCard, or undefined when it has none. */
export function readVCardUid(vcard: string): string | undefined {
  const property = parseProperties(vcard).find(item => item.name === 'UID')
  return property ? unescapeValue(property.value) : undefined
}

/** Turn one vCard into a contact. Unknown properties are dropped. */
export function parseVCard(text: string): Omit<Contact, 'url' | 'etag' | 'addressBook' | 'service'> {
  const properties = parseProperties(text)
  const first = (name: string) => properties.find(property => property.name === name)
  const all = (name: string) => properties.filter(property => property.name === name)
  const plain = (name: string) => {
    const property = first(name)
    return property ? unescapeValue(property.value) : undefined
  }

  const structured = (name: string, count: number): string[] => {
    const property = first(name)
    if (!property) {
      return []
    }
    const parts = splitUnescaped(property.value, ';').map(unescapeValue)
    return Array.from({ length: count }, (_, index) => parts[index] ?? '')
  }

  const [family = '', given = ''] = structured('N', 5)
  const nameParts = [given, family].filter(Boolean).join(' ')

  const addresses: ContactAddress[] = all('ADR').map((property) => {
    const parts = splitUnescaped(property.value, ';').map(unescapeValue)
    return {
      street: parts[2] || undefined,
      city: parts[3] || undefined,
      region: parts[4] || undefined,
      postalCode: parts[5] || undefined,
      country: parts[6] || undefined,
      label: typeLabel(property)
    }
  })

  return {
    uid: plain('UID') || '',
    name: plain('FN') || nameParts || plain('ORG') || plain('EMAIL') || 'Unnamed',
    firstName: given || undefined,
    lastName: family || undefined,
    emails: all('EMAIL').map(property => ({ value: unescapeValue(property.value), label: typeLabel(property) })),
    phones: all('TEL').map(property => ({ value: unescapeValue(property.value), label: typeLabel(property) })),
    addresses,
    organization: plain('ORG')?.replace(/;+$/, '').replace(/;/g, ' · ') || undefined,
    jobTitle: plain('TITLE') || undefined,
    birthday: normalizedBirthday(plain('BDAY')),
    notes: plain('NOTE') || undefined,
    photo: photoValue(first('PHOTO'))
  }
}

function escapeText(value: string): string {
  return value.replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, '\\n')
}

function fold(line: string): string {
  const limit = 75
  if (line.length <= limit) {
    return line
  }

  let folded = line.slice(0, limit)
  let rest = line.slice(limit)
  while (rest.length) {
    folded += `\r\n ${rest.slice(0, limit - 1)}`
    rest = rest.slice(limit - 1)
  }

  return folded
}

function contentLine(name: string, params: string[], value: string): string {
  const head = [name, ...params].join(';')
  return fold(`${head}:${escapedOrRaw(name, value)}`)
}

// These carry `;`-separated components; each is escaped before it is joined,
// so the separators themselves stay literal (N and ADR are not escaped whole).
const TEXT_PROPERTIES = new Set(['FN', 'ORG', 'TITLE', 'NOTE'])

function escapedOrRaw(name: string, value: string): string {
  return TEXT_PROPERTIES.has(name) ? escapeText(value) : value
}

/** The properties the editor owns; everything else is preserved on a patch. */
const MANAGED = new Set(['FN', 'N', 'EMAIL', 'TEL', 'ADR', 'ORG', 'TITLE', 'BDAY', 'NOTE'])

/** The edited properties, rendered as vCard 3.0 lines. */
function managedLines(contact: ContactInput, name: string): string[] {
  const lines = [
    contentLine('FN', [], name),
    contentLine('N', [], [contact.lastName ?? '', contact.firstName ?? '', '', '', ''].map(escapeText).join(';'))
  ]

  for (const email of contact.emails ?? []) {
    lines.push(contentLine('EMAIL', email.label ? [`TYPE=${email.label}`] : [], email.value))
  }
  for (const phone of contact.phones ?? []) {
    lines.push(contentLine('TEL', phone.label ? [`TYPE=${phone.label}`] : [], phone.value))
  }
  for (const address of contact.addresses ?? []) {
    const parts = ['', '', address.street ?? '', address.city ?? '', address.region ?? '', address.postalCode ?? '', address.country ?? '']
    lines.push(contentLine('ADR', address.label ? [`TYPE=${address.label}`] : [], parts.map(escapeText).join(';')))
  }

  if (contact.organization) {
    lines.push(contentLine('ORG', [], contact.organization))
  }
  if (contact.jobTitle) {
    lines.push(contentLine('TITLE', [], contact.jobTitle))
  }
  if (contact.birthday) {
    lines.push(contentLine('BDAY', [], contact.birthday.replace(/-/g, '')))
  }
  if (contact.notes) {
    lines.push(contentLine('NOTE', [], contact.notes))
  }

  return lines
}

/** Serialize a new contact to vCard 3.0; the caller keeps the UID. */
export function serializeVCard(contact: ContactInput, uid: string, name: string): string {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `UID:${uid}`,
    ...managedLines(contact, name)
  ]

  if (contact.photo) {
    lines.push(fold(`PHOTO:${contact.photo}`))
  }

  lines.push('END:VCARD')

  return lines.join('\r\n') + '\r\n'
}

/**
 * Rewrite only the properties the editor owns, leaving every other line — a
 * PHOTO, CATEGORIES, X-* properties, the UID — exactly as the server sent it.
 */
export function patchVCard(vcard: string, contact: ContactInput, name: string): string {
  const lines = unfold(vcard)
  const endIndex = lines.findIndex(line => /^END:VCARD$/i.test(line.trim()))
  const body = endIndex >= 0 ? lines.slice(0, endIndex) : lines
  const kept = body.filter((line) => {
    const property = parseLine(line)
    return !property || !MANAGED.has(property.name)
  })

  return [...kept, ...managedLines(contact, name), 'END:VCARD'].join('\r\n') + '\r\n'
}
