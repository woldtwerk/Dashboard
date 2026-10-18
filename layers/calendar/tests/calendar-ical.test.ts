import { describe, expect, it } from 'vitest'
import { applyOccurrenceDelete, applyOccurrenceEdit, applySeriesEdit, expandEvents, readEventUid, serializeEvent } from '../server/utils/calendar-ical'

const source = { calendar: 'http://dav/cal/', url: 'http://dav/cal/a.ics', etag: 'W/"1"' }
const window = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-10-08T00:00:00Z') }
// The fallback zone, matching the layer's runtime config
const ZONE = 'Europe/Berlin'

const calendar = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`

describe('expandEvents', () => {
  it('includes an event that overlaps the window', () => {
    const events = expandEvents(calendar([
      'BEGIN:VEVENT',
      'UID:meeting@example.com',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'SUMMARY:Standup',
      'LOCATION:Office',
      'END:VEVENT'
    ].join('\r\n')), source, window, ZONE)

    expect(events).toEqual([{
      uid: 'meeting@example.com',
      url: source.url,
      etag: source.etag,
      calendar: source.calendar,
      service: undefined,
      title: 'Standup',
      description: undefined,
      location: 'Office',
      start: '2026-10-05T09:00:00.000Z',
      end: '2026-10-05T10:00:00.000Z',
      allDay: false,
      recurrence: undefined,
      reminders: []
    }])
  })

  it('leaves out an event outside the window', () => {
    const events = expandEvents(calendar([
      'BEGIN:VEVENT',
      'UID:x@example.com',
      'DTSTART:20261020T090000Z',
      'DTEND:20261020T100000Z',
      'SUMMARY:Later',
      'END:VEVENT'
    ].join('\r\n')), source, window, ZONE)

    expect(events).toEqual([])
  })

  it('reads an all-day event as a date', () => {
    const events = expandEvents(calendar([
      'BEGIN:VEVENT',
      'UID:holiday@example.com',
      'DTSTART;VALUE=DATE:20261005',
      'DTEND;VALUE=DATE:20261006',
      'SUMMARY:Holiday',
      'END:VEVENT'
    ].join('\r\n')), source, window, ZONE)

    expect(events[0]).toMatchObject({ allDay: true, start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' })
  })

  it('expands a recurring event into one entry per occurrence in the window', () => {
    const events = expandEvents(calendar([
      'BEGIN:VEVENT',
      'UID:daily@example.com',
      'DTSTART:20261001T090000Z',
      'DTEND:20261001T093000Z',
      'RRULE:FREQ=DAILY;COUNT=10',
      'SUMMARY:Daily',
      'END:VEVENT'
    ].join('\r\n')), source, { start: new Date('2026-10-03T00:00:00Z'), end: new Date('2026-10-05T00:00:00Z') }, ZONE)

    expect(events.map(event => event.start)).toEqual(['2026-10-03T09:00:00.000Z', '2026-10-04T09:00:00.000Z'])
    expect(events.every(event => event.recurring)).toBe(true)
  })
})

describe('serializeEvent', () => {
  it('round-trips a timed event with a reminder', () => {
    const ics = serializeEvent({
      title: 'Lunch',
      start: '2026-10-05T12:00:00.000Z',
      end: '2026-10-05T13:00:00.000Z',
      location: 'Café',
      reminders: [15]
    }, 'lunch@example.com')

    const [event] = expandEvents(ics, { calendar: 'x' }, window, ZONE)

    expect(event).toMatchObject({ uid: 'lunch@example.com', title: 'Lunch', location: 'Café', reminders: [15] })
    expect(event).toMatchObject({ start: '2026-10-05T12:00:00.000Z', end: '2026-10-05T13:00:00.000Z' })
  })

  it('writes an all-day event as an exclusive DATE range', () => {
    const ics = serializeEvent({
      title: 'Trip',
      start: '2026-10-05T00:00:00.000Z',
      end: '2026-10-05T00:00:00.000Z',
      allDay: true
    }, 'trip@example.com')

    expect(ics).toContain('DTSTART;VALUE=DATE:20261005')
    expect(ics).toContain('DTEND;VALUE=DATE:20261006')

    const [event] = expandEvents(ics, { calendar: 'x' }, window, ZONE)
    expect(event).toMatchObject({ allDay: true, start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' })
  })

  it('keeps a recurrence rule', () => {
    const ics = serializeEvent({
      title: 'Standup',
      start: '2026-10-01T09:00:00.000Z',
      end: '2026-10-01T09:30:00.000Z',
      recurrence: 'FREQ=DAILY;COUNT=3'
    }, 'standup@example.com')

    const events = expandEvents(ics, { calendar: 'x' }, window, ZONE)
    expect(events).toHaveLength(3)
    expect(events[0]?.recurrence).toBe('FREQ=DAILY;COUNT=3')
  })

  it('escapes commas and semicolons in text', () => {
    const ics = serializeEvent({ title: 'Sales; Q1, review', start: '2026-10-05T12:00:00.000Z', end: '2026-10-05T13:00:00.000Z' }, 'sales@example.com')

    expect(ics).toContain('SUMMARY:Sales\\; Q1\\, review')
  })
})

const SERIES = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//x//EN',
  'BEGIN:VEVENT',
  'UID:series@example.com',
  'DTSTART:20261001T090000Z',
  'DTEND:20261001T093000Z',
  'SUMMARY:Standup',
  'ORGANIZER;CN=Bob:mailto:bob@example.com',
  'ATTENDEE:mailto:carol@example.com',
  'CATEGORIES:Work',
  'X-PROTON-TAG:signed',
  'RRULE:FREQ=DAILY;COUNT=5',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT15M',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

/** The output with uniform line endings, for `toContain` checks */
const masterComponent = (ics: string) => ics.split('\r\n').join('\n')

const edit = {
  title: 'Standup moved',
  start: '2026-10-03T10:00:00.000Z',
  end: '2026-10-03T10:30:00.000Z'
}

describe('readEventUid', () => {
  it('reads the master UID, ignoring an override', () => {
    const edited = applyOccurrenceEdit(SERIES, '2026-10-02T09:00:00.000Z', { ...edit, start: '2026-10-02T11:00:00.000Z', end: '2026-10-02T11:30:00.000Z' }, ZONE)
    expect(readEventUid(SERIES)).toBe('series@example.com')
    expect(readEventUid(edited)).toBe('series@example.com')
  })
})

describe('applySeriesEdit', () => {
  it('moves the master by the delta and keeps every unmanaged property', () => {
    const out = applySeriesEdit(SERIES, edit, ZONE, '2026-10-03T09:00:00.000Z', new Date('2026-10-10T00:00:00Z'))

    expect(masterComponent(out)).toContain('DTSTART:20261001T100000Z')
    expect(masterComponent(out)).toContain('DTEND:20261001T103000Z')
    expect(masterComponent(out)).toContain('SUMMARY:Standup moved')
    expect(masterComponent(out)).toContain('ORGANIZER;CN=Bob:mailto:bob@example.com')
    expect(masterComponent(out)).toContain('ATTENDEE:mailto:carol@example.com')
    expect(masterComponent(out)).toContain('CATEGORIES:Work')
    expect(masterComponent(out)).toContain('X-PROTON-TAG:signed')
    expect(masterComponent(out)).toContain('RRULE:FREQ=DAILY;COUNT=5')
  })

  it('sets the master absolutely for a plain event', () => {
    const plain = SERIES.replace('RRULE:FREQ=DAILY;COUNT=5\r\n', '')
    const out = applySeriesEdit(plain, { ...edit, title: 'Moved', start: '2026-10-03T10:00:00.000Z', end: '2026-10-03T10:30:00.000Z' }, ZONE)

    expect(masterComponent(out)).toContain('DTSTART:20261003T100000Z')
  })

  it('removes the recurrence when the rule is emptied', () => {
    const out = applySeriesEdit(SERIES, { title: 'One off', start: '2026-10-01T09:00:00.000Z', end: '2026-10-01T09:30:00.000Z', recurrence: '' }, ZONE, '2026-10-01T09:00:00.000Z')

    expect(out).not.toContain('RRULE')
  })

  it('replaces relative alarms and keeps the other alarms', () => {
    const withAbsolute = SERIES.replace('TRIGGER:-PT15M', 'TRIGGER;VALUE=DATE-TIME:20261001T083000Z')
    const out = applySeriesEdit(withAbsolute, { ...edit, reminders: [30] }, ZONE, '2026-10-03T09:00:00.000Z')

    expect(out).toContain('TRIGGER;VALUE=DATE-TIME:20261001T083000Z')
    expect(out).toContain('TRIGGER:-PT30M')
    expect(out).not.toContain('TRIGGER:-PT15M')
  })
})

describe('applyOccurrenceEdit', () => {
  it('adds an override without touching the master', () => {
    const out = applyOccurrenceEdit(SERIES, '2026-10-03T09:00:00.000Z', edit, ZONE, new Date('2026-10-10T00:00:00Z'))
    const text = masterComponent(out)

    expect(text).toContain('DTSTART:20261001T090000Z')
    expect(text).toContain('RECURRENCE-ID:20261003T090000Z')
    expect(text).toContain('DTSTART:20261003T100000Z')
    expect(text).toContain('SUMMARY:Standup moved')
    // The clone keeps the organiser and attendee but not the rule
    expect(text.match(/ORGANIZER/g)).toHaveLength(2)
    expect(text.match(/RRULE/g)).toHaveLength(1)
  })

  it('updates an existing override instead of adding a second one', () => {
    const once = applyOccurrenceEdit(SERIES, '2026-10-03T09:00:00.000Z', edit, ZONE)
    const twice = applyOccurrenceEdit(once, '2026-10-03T09:00:00.000Z', { ...edit, title: 'Later' }, ZONE)

    expect(twice.match(/RECURRENCE-ID/g)).toHaveLength(1)
    expect(masterComponent(twice)).toContain('SUMMARY:Later')
  })
})

describe('applyOccurrenceDelete', () => {
  it('cancels just one occurrence with an EXDATE', () => {
    const out = masterComponent(applyOccurrenceDelete(SERIES, '2026-10-04T09:00:00.000Z', ZONE))

    expect(out).toContain('EXDATE:20261004T090000Z')
    // The rest of the series is untouched
    expect(out).toContain('RRULE:FREQ=DAILY;COUNT=5')
    expect(out).toContain('ORGANIZER')
  })

  it('removes an override for the cancelled occurrence', () => {
    const edited = applyOccurrenceEdit(SERIES, '2026-10-04T09:00:00.000Z', { title: 'Moved', start: '2026-10-04T12:00:00.000Z', end: '2026-10-04T12:30:00.000Z' }, ZONE)
    const out = masterComponent(applyOccurrenceDelete(edited, '2026-10-04T09:00:00.000Z', ZONE))

    expect(out).not.toContain('RECURRENCE-ID')
    expect(out).toContain('EXDATE:20261004T090000Z')
  })
})

describe('expandEvents with overrides', () => {
  it('lists each occurrence once and reports the recurrence id', () => {
    const edited = applyOccurrenceEdit(SERIES, '2026-10-02T09:00:00.000Z', { ...edit, start: '2026-10-02T11:00:00.000Z', end: '2026-10-02T11:30:00.000Z' }, ZONE)
    const events = expandEvents(edited, { calendar: 'x' }, { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-10-05T00:00:00Z') }, ZONE)

    expect(events.map(event => event.start)).toEqual([
      '2026-10-01T09:00:00.000Z',
      '2026-10-02T11:00:00.000Z',
      '2026-10-03T09:00:00.000Z',
      '2026-10-04T09:00:00.000Z'
    ])
    expect(events[1]?.recurrenceId).toBe('2026-10-02T09:00:00.000Z')
    expect(events).toHaveLength(4)
  })
})
