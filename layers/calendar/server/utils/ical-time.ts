import { TZDate } from '@date-fns/tz'
import ICAL from 'ical.js'

type IcalTime = InstanceType<typeof ICAL.Time>
type IcalProperty = InstanceType<typeof ICAL.Property>

/**
 * Windows/Outlook zone names and the IANA zone each means. Servers built on
 * Exchange hand these out; `Intl` does not know them, so a time carrying one
 * would otherwise fall back to the wrong zone.
 */
const WINDOWS_ZONES: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'GMT Standard Time': 'Europe/London',
  'Eastern Standard Time': 'America/New_York',
  'Pacific Standard Time': 'America/Los_Angeles'
}

/** Whether `Intl` accepts the zone as an IANA name, without throwing later */
function isIanaZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The IANA zone a TZID names, mapping the Windows names; undefined when unknown */
function resolveZone(tzid: string): string | undefined {
  const zone = WINDOWS_ZONES[tzid] ?? tzid
  return isIanaZone(zone) ? zone : undefined
}

/** The `TZID` parameter of a DTSTART/DTEND/RECURRENCE-ID property, if any */
export function tzidOf(property: IcalProperty | undefined | null): string | undefined {
  const tzid = property?.getParameter('tzid')
  if (typeof tzid === 'string') {
    return tzid || undefined
  }

  return Array.isArray(tzid) && typeof tzid[0] === 'string' ? tzid[0] : undefined
}

/**
 * The instant an iCalendar time names. ical.js resolves a TZID to a zone only
 * when the object carries a VTIMEZONE for it; a bare `TZID=Europe/Berlin` (what
 * Proton sends) is left floating and `toJSDate` would read its wall time in the
 * server's zone. Placing it in the zone the TZID names here keeps times right.
 */
export function icalTimeToDate(time: IcalTime, tzid: string | undefined, fallbackZone: string): Date {
  // All-day DATE values stay UTC midnight, the convention the views read
  if (time.isDate) {
    return new Date(Date.UTC(time.year, time.month - 1, time.day))
  }

  // A `Z` time, or one ical.js matched to a registered VTIMEZONE, already
  // carries its offset; only a floating time has to be placed in a zone. The
  // test is the resolved zone rather than `TimezoneService`, because another
  // object may have registered the TZID after this one was parsed.
  if (time.zone !== ICAL.Timezone.localTimezone) {
    return time.toJSDate()
  }

  const zone = (tzid && resolveZone(tzid)) || fallbackZone
  const zoned = new TZDate(time.year, time.month - 1, time.day, time.hour, time.minute, time.second, zone)

  // TZDate keeps the zone offset in its own `toISOString`; hand back a plain
  // Date so an instant always serializes as UTC, like every other one here
  return new Date(zoned.getTime())
}
