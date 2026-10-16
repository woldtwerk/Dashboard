/** Configured service instances, shared app-wide. Refresh with `refreshNuxtData('services')`. */
export function useServices() {
  return useFetch('/api/services', { key: 'services', default: () => [] })
}
