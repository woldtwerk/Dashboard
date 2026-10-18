import ICAL from 'ical.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { expandEvents, parseCalendar } from '../server/utils/calendar-ical'
import { icalTimeToDate, tzidOf } from '../server/utils/ical-time'

const ZONE = 'Europe/Berlin'
const source = { calendar: 'http://dav/cal/' }
type IcalTime = InstanceType<typeof ICAL.Time>

const calendar = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`

const event = (lines: string[]) => calendar(['BEGIN:VEVENT', 'UID:x@example.com', ...lines, 'END:VEVENT'].join('\r\n'))

/** A real VTIMEZONE, so ical.js resolves the TZID without the IANA fallback */
const BERLIN_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700329T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'END:VTIMEZONE'
].join('\r\n')

function startTime(ics: string): { time: IcalTime, tzid?: string } {
  const property = parseCalendar(ics).getFirstSubcomponent('vevent')?.getFirstProperty('dtstart')
  return { time: property?.getFirstValue() as IcalTime, tzid: tzidOf(property) }
}

// A registered VTIMEZONE is process-global, so isolate each test's registry
beforeEach(() => ICAL.TimezoneService.reset())

describe('icalTimeToDate', () => {
  it('places a bare TZID wall time in its zone (summer)', () => {
    const { time, tzid } = startTime(event(['DTSTART;TZID=Europe/Berlin:20260711T110000']))

    expect(tzid).toBe('Europe/Berlin')
    expect(icalTimeToDate(time, tzid, ZONE).toISOString()).toBe('2026-07-11T09:00:00.000Z')
  })

  it('places a bare TZID wall time in its zone (winter)', () => {
    const { time, tzid } = startTime(event(['DTSTART;TZID=Europe/Berlin:20260111T110000']))

    expect(icalTimeToDate(time, tzid, ZONE).toISOString()).toBe('2026-01-11T10:00:00.000Z')
  })

  it('reads a TZID backed by a VTIMEZONE the same way', () => {
    const { time, tzid } = startTime(calendar([BERLIN_VTIMEZONE, 'BEGIN:VEVENT', 'UID:x@example.com', 'DTSTART;TZID=Europe/Berlin:20260711T110000', 'END:VEVENT'].join('\r\n')))

    expect(tzid).toBe('Europe/Berlin')
    expect(icalTimeToDate(time, tzid, ZONE).toISOString()).toBe('2026-07-11T09:00:00.000Z')
  })

  it('leaves a UTC time unchanged', () => {
    const { time, tzid } = startTime(event(['DTSTART:20260711T110000Z']))

    expect(tzid).toBeUndefined()
    expect(icalTimeToDate(time, tzid, ZONE).toISOString()).toBe('2026-07-11T11:00:00.000Z')
  })

  it('reads a floating time in the fallback zone', () => {
    const { time, tzid } = startTime(event(['DTSTART:20260711T110000']))

    expect(tzid).toBeUndefined()
    expect(icalTimeToDate(time, tzid, ZONE).toISOString()).toBe('2026-07-11T09:00:00.000Z')
  })

  it('maps a Windows zone name to the IANA zone it means', () => {
    const { time, tzid } = startTime(event(['DTSTART;TZID=W. Europe Standard Time:20260711T110000']))

    expect(icalTimeToDate(time, tzid, ZONE).toISOString()).toBe('2026-07-11T09:00:00.000Z')
  })

  it('falls back for an unknown zone', () => {
    const { time, tzid } = startTime(event(['DTSTART;TZID=Mars/Olympus:20260711T110000']))

    expect(icalTimeToDate(time, tzid, ZONE).toISOString()).toBe('2026-07-11T09:00:00.000Z')
    expect(icalTimeToDate(time, tzid, 'UTC').toISOString()).toBe('2026-07-11T11:00:00.000Z')
  })

  it('keeps all-day values at UTC midnight', () => {
    const { time, tzid } = startTime(event(['DTSTART;VALUE=DATE:20260711']))

    expect(icalTimeToDate(time, tzid, ZONE).toISOString()).toBe('2026-07-11T00:00:00.000Z')
  })
})

describe('expandEvents with a bare TZID', () => {
  it('keeps the wall time across the DST switch of a weekly rule', () => {
    const events = expandEvents(event([
      'DTSTART;TZID=Europe/Berlin:20261021T193000',
      'DTEND;TZID=Europe/Berlin:20261021T200000',
      'RRULE:FREQ=WEEKLY;COUNT=3'
    ]), source, { start: new Date('2026-10-20T00:00:00Z'), end: new Date('2026-11-06T00:00:00Z') }, ZONE)

    // 19:30 CEST before 25 October, 19:30 CET after
    expect(events.map(item => item.start)).toEqual([
      '2026-10-21T17:30:00.000Z',
      '2026-10-28T18:30:00.000Z',
      '2026-11-04T18:30:00.000Z'
    ])
    expect(events.map(item => item.end)).toEqual([
      '2026-10-21T18:00:00.000Z',
      '2026-10-28T19:00:00.000Z',
      '2026-11-04T19:00:00.000Z'
    ])
  })
})
