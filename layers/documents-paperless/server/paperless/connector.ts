import { createError } from 'nuxt/server'
import type { Connector } from '../../../core/server/utils/services'
import type { SetupValues } from '../../../core/shared/types/setup'
import { testPaperlessConnection } from './provider'

function normalizedUrl(value: unknown): string {
  return String(value ?? '').trim().replace(/\/+$/, '')
}

/** Exchanges a username/password for an API token; the password is not kept. */
async function fetchToken(url: string, username: string, password: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${url}/api/token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ username, password })
    })
  } catch {
    throw createError({ status: 400, statusText: 'The Paperless-ngx instance is not reachable' })
  }

  if (!response.ok) {
    throw createError({ status: 400, statusText: 'Could not sign in to Paperless-ngx. Check the URL and credentials.' })
  }

  const data = await response.json() as { token?: string }
  if (!data.token) {
    throw createError({ status: 400, statusText: 'Paperless-ngx did not return a token' })
  }
  return data.token
}

/** The Paperless-ngx connector, registered by the layer's Nitro plugin. */
export function createPaperlessConnector(options: { defaultUrl?: string } = {}): Connector {
  return {
    id: 'paperless',
    domain: 'documents',
    title: 'Paperless-ngx',
    description: 'Documents, tags and saved views in a Paperless-ngx instance.',
    icon: 'i-lucide-file-text',

    wizard: {
      // A stored token is never reused for another instance
      bindSecretsTo: ['url'],
      steps: [{
        id: 'connect',
        title: 'Connect',
        description: 'Paperless-ngx instance',
        icon: 'i-lucide-plug',
        intro: 'Point this at a running Paperless-ngx instance. Enter an API token, or a username and password from which the server obtains a token. Only the token is stored, encrypted; the password is discarded.',
        links: [{ label: 'Paperless-ngx API', to: 'https://docs.paperless-ngx.com/api/' }],
        fields: [
          {
            name: 'url',
            label: 'URL',
            type: 'text',
            required: true,
            placeholder: options.defaultUrl || 'http://paperless:8000',
            description: 'Base URL of the instance, e.g. http://paperless:8000 inside the project network'
          },
          {
            name: 'token',
            label: 'API token',
            type: 'password',
            secret: true,
            description: 'From your Paperless-ngx profile. Leave empty to sign in with username and password instead'
          },
          {
            name: 'username',
            label: 'Username',
            type: 'text',
            description: 'Alternative to an API token'
          },
          {
            name: 'password',
            label: 'Password',
            type: 'password',
            secret: true,
            description: 'Used once to obtain a token, never stored'
          }
        ]
      }]
    },

    async complete(values: SetupValues): Promise<SetupValues> {
      const url = normalizedUrl(values.url)
      let token = values.token ? String(values.token) : ''

      if (!token && values.username && values.password) {
        token = await fetchToken(url, String(values.username), String(values.password))
      }

      // Only the URL and the token are persisted; the password is discarded here
      return { url, token }
    },

    validate(values: SetupValues) {
      if (!normalizedUrl(values.url)) {
        return 'The URL is required'
      }
      if (!values.token) {
        return 'Enter an API token, or a username and password to obtain one'
      }
    },

    test: values => testPaperlessConnection(values)
  }
}
