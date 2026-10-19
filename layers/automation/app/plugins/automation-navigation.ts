export default defineNuxtPlugin(() => {
  defineNavigationChildren('automation', useAutomationNavigation)
})
