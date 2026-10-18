/** What an app password may be used for. */
export type AppPasswordScope = 'dav' | 'mail'

/** Every scope, in the order the settings form offers them. */
export const APP_PASSWORD_SCOPES: AppPasswordScope[] = ['dav', 'mail']

/** An app password as the API lists it; the secret itself is only returned on creation. */
export interface AppPasswordInfo {
  id: string
  name: string
  scopes: AppPasswordScope[]
  /** First characters of the token, so a listed entry is recognizable */
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

/** The response of creation: the only time the secret is visible. */
export interface CreatedAppPassword extends AppPasswordInfo {
  token: string
}
