import { useRuntimeConfig } from 'nuxt/server'
import { authenticateAppPassword } from '../../../core/server/utils/app-passwords'
import type { ClientAccessDeps } from './handle-auth'
import { findDavUpstream, findMailUpstream, resolveHostIpv4 } from './upstream'

/**
 * The dependencies of the proxy auth endpoints. Only the shared secret comes
 * from the runtime config; the rest are the core helpers they wrap.
 */
export function useClientAccessDeps(): ClientAccessDeps {
  return {
    secret: useRuntimeConfig().clientAccess.secret,
    authenticate: authenticateAppPassword,
    davUpstream: findDavUpstream,
    mailUpstream: findMailUpstream,
    resolveHost: resolveHostIpv4
  }
}
