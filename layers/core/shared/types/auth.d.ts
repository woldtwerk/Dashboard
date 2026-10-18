/** The signed-in owner, as it travels in the session and to the client. */
export interface AuthUser {
  id: string
  email: string
  name: string
}

/** Public answer of `GET /api/auth/state`, used by the login page. */
export interface AuthState {
  hasUser: boolean
}

// The login stores this shape in the sealed session, so `useUserSession` and the
// server routes see it typed instead of an empty `User`. Kept in one file so it
// does not collide with a same-named `auth.ts`.
declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    name: string
  }

  interface UserSession {
    /** ISO timestamp of when this session was created by a login or setup. */
    loggedInAt?: string
  }
}
