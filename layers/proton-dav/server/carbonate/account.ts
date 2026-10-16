import type { SetupValues } from '../../../core/shared/types/setup'

/** The DAV credentials the carbonate control API returns. */
export interface CarbonateDav {
  url: string
  username: string
  password: string
}

export interface CarbonateAccount {
  account: string
  dav: CarbonateDav
}

/** Service values for a calendar or contacts service; the DAV path depends on the domain. */
export function toCarbonateValues({ account, dav }: CarbonateAccount, path: string): SetupValues {
  return {
    account,
    url: toDavPath(dav.url, path),
    username: dav.username,
    // The bridge password. Stored encrypted as the service's secret.
    password: dav.password
  }
}

/** The DAV root for a protocol, e.g. `http://host:8081` + `caldav` -> `http://host:8081/caldav`. */
export function toDavPath(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, '')
  const suffix = `/${path.replace(/^\/+|\/+$/g, '')}`

  return trimmed.endsWith(suffix) ? trimmed : `${trimmed}${suffix}`
}

/** Message and missing input from an error of the carbonate control API. */
export function toCarbonateError(status: number | undefined, data: unknown): { status: number, message: string, need?: string, verificationUrl?: string } {
  const { error, need, verificationUrl } = (data ?? {}) as { error?: string, need?: string | null, verificationUrl?: string | null }

  if (!status) {
    return { status: 503, message: 'The carbonate container is not reachable. Is it running?' }
  }

  return {
    status,
    message: error || 'carbonate could not handle the request',
    need: need ?? undefined,
    verificationUrl: verificationUrl ?? undefined
  }
}
