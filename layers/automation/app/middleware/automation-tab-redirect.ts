/**
 * The automation sections started as `?tab=` values on `/automation` before they
 * became routes; links built back then still arrive with the param.
 */
export default defineNuxtRouteMiddleware((to) => {
  if (to.path !== '/automation' || !to.query.tab) {
    return
  }

  const query = { ...to.query }
  delete query.tab
  return navigateTo({
    path: to.query.tab === 'activity' ? '/automation/activity' : '/automation',
    query
  }, { replace: true })
})
