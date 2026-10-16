import { describe, expect, it } from 'vitest'
import { parseVCard, patchVCard, readVCardUid, serializeVCard } from '../server/utils/vcard'

const card = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'UID:abc-123',
  'FN:Ada Lovelace',
  'N:Lovelace;Ada;;;',
  'EMAIL;TYPE=WORK:ada@example.com',
  'EMAIL;TYPE=home:ada@gmail.com',
  'TEL;TYPE=CELL:+49 123 456',
  'ADR;TYPE=HOME:;;Bahnhofstrasse 1;Berlin;;10115;Germany',
  'ORG:Analytical Engines Ltd',
  'TITLE:Mathematician',
  'BDAY:18151210',
  'NOTE:First programmer',
  'END:VCARD'
].join('\r\n')

describe('parseVCard', () => {
  it('reads the common properties', () => {
    const contact = parseVCard(card)

    expect(contact).toMatchObject({
      uid: 'abc-123',
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      organization: 'Analytical Engines Ltd',
      jobTitle: 'Mathematician',
      birthday: '1815-12-10',
      notes: 'First programmer'
    })
    expect(contact.emails).toEqual([
      { value: 'ada@example.com', label: 'work' },
      { value: 'ada@gmail.com', label: 'home' }
    ])
    expect(contact.phones).toEqual([{ value: '+49 123 456', label: 'cell' }])
    expect(contact.addresses).toEqual([{
      street: 'Bahnhofstrasse 1',
      city: 'Berlin',
      region: undefined,
      postalCode: '10115',
      country: 'Germany',
      label: 'home'
    }])
  })

  it('unfolds continued lines', () => {
    const folded = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Ada', 'NOTE:line one ', ' line two', 'END:VCARD'].join('\r\n')
    expect(parseVCard(folded).notes).toBe('line one line two')
  })

  it('unescapes commas and semicolons in text values', () => {
    const escaped = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Smith\\, John', 'END:VCARD'].join('\r\n')
    expect(parseVCard(escaped).name).toBe('Smith, John')
  })

  it('falls back to the name parts when there is no formatted name', () => {
    const noFn = ['BEGIN:VCARD', 'VERSION:3.0', 'N:Lovelace;Ada;;;', 'END:VCARD'].join('\r\n')
    expect(parseVCard(noFn).name).toBe('Ada Lovelace')
  })

  it('wraps a bare base64 photo in a data URI', () => {
    const withPhoto = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Ada', 'PHOTO;ENCODING=b:QUJD', 'END:VCARD'].join('\r\n')
    expect(parseVCard(withPhoto).photo).toBe('data:image/jpeg;base64,QUJD')
  })
})

describe('serializeVCard', () => {
  it('round-trips the fields it writes', () => {
    const input = {
      firstName: 'Grace',
      lastName: 'Hopper',
      emails: [{ value: 'grace@navy.mil', label: 'work' }],
      phones: [{ value: '+1 202 555 0142', label: 'cell' }],
      addresses: [{ street: '1 Navy Yard', city: 'Washington', country: 'USA' }],
      organization: 'US Navy',
      jobTitle: 'Rear Admiral',
      birthday: '1906-12-09',
      notes: 'COBOL'
    }

    const contact = parseVCard(serializeVCard(input, 'grace-1', 'Grace Hopper'))

    expect(contact).toMatchObject({
      uid: 'grace-1',
      name: 'Grace Hopper',
      firstName: 'Grace',
      lastName: 'Hopper',
      organization: 'US Navy',
      jobTitle: 'Rear Admiral',
      birthday: '1906-12-09',
      notes: 'COBOL'
    })
    expect(contact.emails).toEqual([{ value: 'grace@navy.mil', label: 'work' }])
    expect(contact.addresses[0]).toMatchObject({ street: '1 Navy Yard', city: 'Washington', country: 'USA' })
  })

  it('escapes text that would break a line', () => {
    const text = serializeVCard({ emails: [], phones: [], addresses: [], firstName: 'A', lastName: 'B; C, D' }, 'x', 'A B; C, D')
    expect(text).toContain('B\\; C\\, D')
  })
})

describe('readVCardUid', () => {
  it('reads a UID or reports that there is none', () => {
    expect(readVCardUid(card)).toBe('abc-123')
    expect(readVCardUid(['BEGIN:VCARD', 'VERSION:3.0', 'FN:No Uid', 'END:VCARD'].join('\r\n'))).toBeUndefined()
  })
})

describe('patchVCard', () => {
  const existing = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'UID:keep-me',
    'FN:Ada Lovelace',
    'N:Lovelace;Ada;;;',
    'EMAIL;TYPE=WORK:ada@example.com',
    'TEL;TYPE=CELL:+49 123',
    'PHOTO:https://example.com/ada.jpg',
    'CATEGORIES:Friend,Math',
    'X-PROTON-SIGNATURE:abc',
    'REV:20260101T000000Z',
    'END:VCARD'
  ].join('\r\n')

  it('rewrites the edited properties and keeps the rest', () => {
    const out = patchVCard(existing, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      emails: [{ value: 'ada@new.example', label: 'home' }],
      phones: [],
      addresses: [],
      organization: 'Analytical Engines'
    }, 'Ada Lovelace')

    expect(out).toContain('UID:keep-me')
    expect(out).toContain('PHOTO:https://example.com/ada.jpg')
    expect(out).toContain('CATEGORIES:Friend,Math')
    expect(out).toContain('X-PROTON-SIGNATURE:abc')
    expect(out).toContain('REV:20260101T000000Z')
    expect(out).toContain('EMAIL;TYPE=home:ada@new.example')
    expect(out).toContain('ORG:Analytical Engines')
    // The replaced properties appear once
    expect(out.match(/EMAIL/g) ?? []).toHaveLength(1)
    expect(out.match(/TEL/g) ?? []).toHaveLength(0)
    expect(out.match(/FN/g) ?? []).toHaveLength(1)
  })

  it('round-trips through the parser', () => {
    const out = patchVCard(existing, { firstName: 'Ada', lastName: 'Byron', emails: [], phones: [], addresses: [] }, 'Ada Byron')
    expect(parseVCard(out)).toMatchObject({ uid: 'keep-me', firstName: 'Ada', lastName: 'Byron', name: 'Ada Byron' })
  })
})
