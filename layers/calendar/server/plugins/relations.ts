import { entityKey, entityLink, normalizeEmail } from '../../../core/shared/entities'
import type { EntityRef, Relation, RelationKind } from '../../../core/shared/types/entities'
import { registerRelationProvider } from '../../../core/server/utils/relations'
import type { CalendarEvent } from '../../shared/types/calendar'
import { objectParticipantRoles } from '../utils/calendar-ical'
import { cachedEventsForParticipant, cachedObjectsByUid } from '../utils/calendar-sync'

const DAY_MS = 24 * 60 * 60 * 1000

/** Relations reach one year back and one year ahead, centred on now */
export function calendarRelationWindow(now = new Date()): { start: string, end: string } {
  return {
    start: new Date(now.getTime() - 365 * DAY_MS).toISOString(),
    end: new Date(now.getTime() + 365 * DAY_MS).toISOString()
  }
}

function eventRef(service: string, event: CalendarEvent): EntityRef {
  return { type: 'event', service, id: [event.calendar, event.uid, event.recurrenceId ?? ''].join('|') }
}

function eventRelation(service: string, event: CalendarEvent, kind: RelationKind): Relation {
  const ref = eventRef(service, event)

  return {
    kind,
    weight: 1,
    item: {
      ref,
      title: event.title,
      subtitle: event.location,
      at: event.start,
      to: entityLink(ref),
      icon: 'i-lucide-calendar'
    }
  }
}

function personRelation(email: string, kind: RelationKind, at?: string): Relation {
  const ref: EntityRef = { type: 'person', id: email }

  return {
    kind,
    weight: 1,
    item: {
      ref,
      title: email,
      at,
      to: entityLink(ref),
      icon: 'i-lucide-user'
    }
  }
}

async function relatedToPerson(email: string, limit: number): Promise<Relation[]> {
  const window = calendarRelationWindow()
  const timeZone = useRuntimeConfig().public.calendar.timeZone
  const services = await listServices('calendar')
  const relations = new Map<string, Relation>()

  for (const { id } of services) {
    try {
      const events = await cachedEventsForParticipant(id, email, window, timeZone)

      for (const { event, organizer } of events) {
        const kind: RelationKind = organizer === email ? 'organizer' : 'attendee'
        const relation = eventRelation(id, event, kind)
        relations.set(entityKey(relation.item.ref), relation)
      }
    } catch (error) {
      // One unreadable cache must not hide the other services
      useServiceLogger('calendar', id).warn('Could not read event participants', { error: String(error) })
    }
  }

  return [...relations.values()]
    .sort((left, right) => (right.item.at ?? '').localeCompare(left.item.at ?? ''))
    .slice(0, Math.max(0, limit) + 1)
}

async function relatedToEvent(ref: EntityRef, limit: number): Promise<Relation[]> {
  const [, uid] = ref.id.split('|')
  if (!uid) {
    return []
  }

  const services = ref.service
    ? [{ id: ref.service }]
    : await listServices('calendar')
  const people = new Map<string, Relation>()

  for (const { id } of services) {
    try {
      for (const row of await cachedObjectsByUid(id, uid)) {
        const roles = objectParticipantRoles(row.data)

        for (const email of roles.participants) {
          const kind: RelationKind = roles.organizer === email ? 'organizer' : 'attendee'
          const known = people.get(email)
          if (!known || kind === 'organizer') {
            people.set(email, personRelation(email, kind, row.firstStart.toISOString()))
          }
        }
      }
    } catch (error) {
      useServiceLogger('calendar', id).warn('Could not read event participants', { error: String(error) })
    }
  }

  return [...people.values()].slice(0, Math.max(0, limit) + 1)
}

export default defineNitroPlugin(() => {
  registerRelationProvider('calendar', {
    label: 'Calendar',
    related(ref, { limit }) {
      if (ref.type === 'person') {
        return relatedToPerson(normalizeEmail(ref.id) ?? ref.id, limit)
      }
      return ref.type === 'event' ? relatedToEvent(ref, limit) : Promise.resolve([])
    }
  })
})
