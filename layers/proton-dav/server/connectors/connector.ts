import type { SetupValues } from '../../../core/shared/types/setup'
import type { Connector } from '../../../core/server/utils/services'
import { testCalDavConnection } from '../../../calendar/server/utils/calendar-provider'
import { testCardDavConnection } from '../../../contacts/server/utils/contacts-provider'
import { toDavPath } from '../carbonate/account'

// Fields the sign-in component fills; the DAV path is added per domain below
const DAV_FIELDS = [
  { name: 'account', label: 'Proton account', type: 'text' as const, required: true },
  { name: 'url', label: 'DAV URL', type: 'text' as const, required: true },
  { name: 'username', label: 'DAV username', type: 'text' as const, required: true },
  { name: 'password', label: 'DAV password', type: 'password' as const, secret: true, required: true }
]

/**
 * Turns the base URL carbonate reports into the protocol's root. The same
 * sign-in serves both calendars and contacts, and each service stores the URL
 * its own protocol needs.
 */
function withDavPath(path: string) {
  return async (values: SetupValues): Promise<SetupValues> => ({ ...values, url: toDavPath(String(values.url ?? ''), path) })
}

/** Proton Calendar via carbonate, the CalDAV/CardDAV bridge (unreleased, private API). */
export const carbonateCalendarConnector: Connector = {
  id: 'carbonate-calendar',
  domain: 'calendar',
  title: 'Proton Calendar',
  description: 'End-to-end encrypted calendars via carbonate, a CalDAV bridge.',
  icon: 'i-lucide-calendar',

  wizard: {
    bindSecretsTo: ['url', 'username'],
    steps: [{
      id: 'signin',
      title: 'Sign in',
      description: 'Proton account',
      icon: 'i-lucide-log-in',
      intro: 'Proton has no public calendar API. The dashboard reads your calendars through carbonate, a CalDAV/CardDAV bridge that runs in its own container and decrypts your data there. carbonate is not yet released and talks to a private Proton API — use it with that in mind. Sign in once, and the container keeps the session.',
      component: 'CarbonateLogin',
      fields: DAV_FIELDS
    }]
  },

  complete: withDavPath('caldav'),
  test: values => testCalDavConnection(values)
}

/** Proton Contacts via carbonate. */
export const carbonateContactsConnector: Connector = {
  id: 'carbonate-contacts',
  domain: 'contacts',
  title: 'Proton Contacts',
  description: 'End-to-end encrypted contacts via carbonate, a CardDAV bridge.',
  icon: 'i-lucide-contact',

  wizard: {
    bindSecretsTo: ['url', 'username'],
    steps: [{
      id: 'signin',
      title: 'Sign in',
      description: 'Proton account',
      icon: 'i-lucide-log-in',
      intro: 'Proton has no public contacts API. The dashboard reads your address books through carbonate, a CalDAV/CardDAV bridge that runs in its own container and decrypts your data there. carbonate is not yet released and talks to a private Proton API — use it with that in mind.',
      component: 'CarbonateLogin',
      fields: DAV_FIELDS
    }]
  },

  complete: withDavPath('carddav'),
  test: values => testCardDavConnection(values)
}

const GENERIC_FIELDS = [
  { name: 'url', label: 'Server URL', type: 'text' as const, required: true, placeholder: 'https://dav.example.com/caldav/' },
  { name: 'username', label: 'Username', type: 'text' as const, required: true },
  { name: 'password', label: 'Password', type: 'password' as const, secret: true, required: true }
]

const GENERIC_CARD_FIELDS = [
  { name: 'url', label: 'Server URL', type: 'text' as const, required: true, placeholder: 'https://dav.example.com/carddav/' },
  { name: 'username', label: 'Username', type: 'text' as const, required: true },
  { name: 'password', label: 'Password', type: 'password' as const, secret: true, required: true }
]

/** Any CalDAV server, e.g. Nextcloud or a Fastmail calendar. */
export const caldavConnector: Connector = {
  id: 'caldav',
  domain: 'calendar',
  title: 'CalDAV',
  description: 'Any standards-compliant CalDAV server.',
  icon: 'i-lucide-calendar-days',

  wizard: {
    bindSecretsTo: ['url', 'username'],
    steps: [{
      id: 'credentials',
      title: 'Server',
      description: 'CalDAV account',
      icon: 'i-lucide-server',
      fields: GENERIC_FIELDS
    }]
  },

  test: values => testCalDavConnection(values)
}

/** Any CardDAV server. */
export const carddavConnector: Connector = {
  id: 'carddav',
  domain: 'contacts',
  title: 'CardDAV',
  description: 'Any standards-compliant CardDAV server.',
  icon: 'i-lucide-contact-round',

  wizard: {
    bindSecretsTo: ['url', 'username'],
    steps: [{
      id: 'credentials',
      title: 'Server',
      description: 'CardDAV account',
      icon: 'i-lucide-server',
      fields: GENERIC_CARD_FIELDS
    }]
  },

  test: values => testCardDavConnection(values)
}
