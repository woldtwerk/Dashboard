import ICAL from 'ical.js'
import { parseCalendar } from '../utils/calendar-ical'
import { icalTimeToDate, tzidOf } from '../utils/ical-time'

type IcalComponent = InstanceType<typeof ICAL.Component>
type IcalEvent = InstanceType<typeof ICAL.Event>
type IcalTime = InstanceType<typeof ICAL.Time>

/** The span of the whole object, used to narrow window queries to candidates. */
export interface ObjectBounds {
  uid: string
  firstStart: Date
  /** End of the last occurrence; null when a series recurs without an end */
  lastEnd: Date | null
}

// Expansion always starts at DTSTART, so a saved rule cannot make this unbounded.
const MAX_OCCURRENCES = 10_000

function isMaster(component: IcalComponent): boolean {
  return !component.getFirstProperty('recurrence-id')
}

function findMaster(calendar: IcalComponent): IcalComponent | undefined {
  const events = calendar.getAllSubcomponents('vevent')
  return events.find(isMaster) ?? events[0]
}

/** Date-only values are UTC midnight; a TZID time is placed in its zone */
function toDate(time: IcalTime, tzid: string | undefined, fallbackZone: string): Date {
  return icalTimeToDate(time, tzid, fallbackZone)
}

function eventEnd(event: IcalEvent, tzid: string | undefined, fallbackZone: string): Date {
  return toDate(event.endDate, tzid, fallbackZone)
}

/**
 * End of the last occurrence of a rule. Null when nothing bounds it, which
 * includes a rule with more occurrences than expansion would ever walk.
 */
function recurrenceEnd(event: IcalEvent, rule: InstanceType<typeof ICAL.Recur>, tzid: string | undefined, fallbackZone: string): Date | null {
  if (!rule.isFinite() || (rule.count && rule.count > MAX_OCCURRENCES)) {
    return null
  }

  const durationMs = event.duration.toSeconds() * 1000
  const iterator = rule.iterator(event.startDate)
  let last: IcalTime | undefined
  let exhausted = false

  for (let count = 0; count < MAX_OCCURRENCES; count++) {
    const occurrence = iterator.next()
    if (!occurrence || (rule.until && occurrence.compare(rule.until) > 0)) {
      exhausted = true
      break
    }
    // The iterator advances the same Time on the next call, which is how it
    // discovers that UNTIL was passed; keep this occurrence's value.
    last = occurrence.clone()
  }

  // The cap cut a finite rule short; treating it as unbounded never drops an event
  if (!exhausted || !last) {
    return null
  }

  return new Date(toDate(last, tzid, fallbackZone).getTime() + durationMs)
}

/** Start and end of one object's master event and its overrides. */
export function objectBounds(ics: string, fallbackZone: string): ObjectBounds {
  const calendar = parseCalendar(ics)
  const components = calendar.getAllSubcomponents('vevent')
  const master = findMaster(calendar)
  if (!master) {
    throw new Error('The calendar object has no event')
  }

  const event = new ICAL.Event(master)
  const startTzid = tzidOf(master.getFirstProperty('dtstart'))
  const endTzid = tzidOf(master.getFirstProperty('dtend')) ?? startTzid
  let firstStart = toDate(event.startDate, startTzid, fallbackZone)
  let lastEnd: Date | null = eventEnd(event, endTzid, fallbackZone)

  const rule = master.getFirstPropertyValue('rrule')
  if (rule instanceof ICAL.Recur) {
    lastEnd = recurrenceEnd(event, rule, startTzid, fallbackZone)
  }

  // Overrides may move an occurrence outside the master's span
  for (const component of components.filter(item => !isMaster(item))) {
    const override = new ICAL.Event(component)
    const overrideStartTzid = tzidOf(component.getFirstProperty('dtstart'))
    const overrideEndTzid = tzidOf(component.getFirstProperty('dtend')) ?? overrideStartTzid
    const start = toDate(override.startDate, overrideStartTzid, fallbackZone)
    const end = eventEnd(override, overrideEndTzid, fallbackZone)

    if (start < firstStart) {
      firstStart = start
    }
    if (lastEnd !== null && end > lastEnd) {
      lastEnd = end
    }
  }

  return { uid: event.uid, firstStart, lastEnd }
}
