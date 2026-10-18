import { describe, expect, it } from 'vitest'
import { objectParticipantRoles, objectParticipants } from '../server/utils/calendar-ical'

const calendar = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`

const event = (lines: string[]) => calendar(['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n'))

describe('objectParticipants', () => {
  it('collects the organizer and every attendee, normalized and deduplicated', () => {
    expect(objectParticipants(event([
      'UID:meeting@example.com',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'ORGANIZER;CN=Jane Doe:mailto:Jane@Example.com',
      'ATTENDEE;CN=Bob:mailto:bob@example.com',
      'ATTENDEE:MAILTO:JANE@example.com'
    ]))).toEqual(['bob@example.com', 'jane@example.com'])
  })

  it('reads attendees of an override event too', () => {
    expect(objectParticipants(calendar([
      'BEGIN:VEVENT',
      'UID:series@example.com',
      'DTSTART:20261001T090000Z',
      'DTEND:20261001T093000Z',
      'RRULE:FREQ=DAILY;COUNT=2',
      'ATTENDEE:mailto:team@example.com',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:series@example.com',
      'RECURRENCE-ID:20261002T090000Z',
      'DTSTART:20261002T100000Z',
      'DTEND:20261002T110000Z',
      'ATTENDEE:mailto:guest@example.com',
      'END:VEVENT'
    ].join('\r\n')))).toEqual(['guest@example.com', 'team@example.com'])
  })

  it('ignores values that are not addresses', () => {
    expect(objectParticipants(event([
      'UID:plain@example.com',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'ATTENDEE:Jane Doe'
    ]))).toEqual([])
  })

  it('is empty without an event', () => {
    expect(objectParticipants(calendar(''))).toEqual([])
  })
})

describe('objectParticipantRoles', () => {
  it('names the organizer separately, but keeps them among the participants', () => {
    const roles = objectParticipantRoles(event([
      'UID:meeting@example.com',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'ORGANIZER:mailto:jane@example.com',
      'ATTENDEE:mailto:bob@example.com'
    ]))

    expect(roles.organizer).toBe('jane@example.com')
    expect(roles.participants).toEqual(['bob@example.com', 'jane@example.com'])
  })

  it('has no organizer when the object names none', () => {
    const roles = objectParticipantRoles(event([
      'UID:meeting@example.com',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'ATTENDEE:mailto:bob@example.com'
    ]))

    expect(roles.organizer).toBeUndefined()
  })
})
