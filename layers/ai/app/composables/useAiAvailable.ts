/** Whether an AI service is set up, for showing AI features */
export function useAiAvailable() {
  const { data: services } = useServices()
  return computed(() => services.value.some(service => service.domain === 'ai'))
}
