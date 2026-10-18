export type EntityType = 'person' | 'mail' | 'event' | 'contact' | 'document' | 'file'

/** A stable reference to one item of any domain */
export interface EntityRef {
  type: EntityType
  /** Service id; absent for `person` (people span services) */
  service?: string
  /** Domain-specific id: person = normalized email; mail = `<mailbox>/<uid>`; event = `<calendarUrl>|<uid>|<recurrenceId?>`; contact = contact uid; document = Paperless id; file = Drive path */
  id: string
}

export type RelationKind
  = | 'from' | 'to' | 'cc' // person ↔ mail
    | 'attendee' | 'organizer' // person ↔ event
    | 'contact' // person ↔ contact card
    | 'correspondent' // person ↔ document
    | 'mentions' // document/mail text mentions the person (weaker)
    | 'attachment' // mail ↔ exchanged attachment
    | 'shared' // person ↔ shared drive file

/** One item shown in a related list or as a graph node */
export interface EntitySummary {
  ref: EntityRef
  title: string
  subtitle?: string
  /** ISO time used for sorting, e.g. mail date or event start */
  at?: string
  /** Page to open the item */
  to: string
  icon?: string
}

export interface Relation {
  kind: RelationKind
  /** 1 = structural (from/attendee/correspondent), < 1 = inferred (mentions) */
  weight: number
  item: EntitySummary
}

/** Related items of one entity, grouped by the domain that found them */
export interface RelatedGroup {
  domain: string
  label: string
  relations: Relation[]
  /** True when the domain had more than it returned */
  truncated?: boolean
}

export interface Person {
  /** Normalized primary email */
  key: string
  name?: string
  emails: string[]
  /** Contact cards that hold any of the emails */
  contacts: EntityRef[]
}

export interface GraphNode { key: string, ref: EntityRef, label: string, domain: string, type: EntityType, to: string }
export interface GraphLink { source: string, target: string, kind: RelationKind, weight: number }
export interface EntityGraph { nodes: GraphNode[], links: GraphLink[], /** keys of nodes whose neighbours were not loaded yet */ frontier: string[] }
