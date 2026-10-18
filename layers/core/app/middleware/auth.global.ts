import { postLoginRedirect } from '../utils/auth'

/**
 * Requires a session everywhere but the login page. A visitor without one is
 * sent to `/login` with the page they wanted; a signed-in visitor never sees
 * the login page again.
 */
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()

  if (!loggedIn.value) {
    if (to.path === '/login') {
      return
    }

    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }

  if (to.path === '/login') {
    return navigateTo(postLoginRedirect(to.query.redirect))
  }
})
