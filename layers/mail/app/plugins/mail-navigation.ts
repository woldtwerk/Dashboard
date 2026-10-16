export default defineNuxtPlugin(() => {
  defineNavigationChildren('mail', useMailNavigation)
})
