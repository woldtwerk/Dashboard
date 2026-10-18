import { createSharedComposable } from '@vueuse/core'

export type SettingsPayload = Record<string, Record<string, unknown>>

const useSettingsState = createSharedComposable(() => {
  const toast = useToast()
  const { data, refresh } = useFetch<SettingsPayload>('/api/settings', {
    key: 'settings',
    default: () => ({})
  })

  // A change made in another tab (or by another settings form) refreshes this tab
  useDomainEvents({ domains: ['core'] }, (event) => {
    if (event.type === 'changed' && event.resource?.startsWith('settings:')) {
      void refresh()
    }
  })

  async function save<T extends object>(section: string, value: T): Promise<void> {
    const snapshot = data.value[section]

    // Optimistic: the form shows the new value before the request returns
    data.value = { ...data.value, [section]: value as Record<string, unknown> }

    try {
      const saved = await $fetch<Record<string, unknown>>(`/api/settings/${encodeURIComponent(section)}`, {
        method: 'PUT',
        body: value
      })
      data.value = { ...data.value, [section]: saved }
    } catch {
      const rolledBack = Object.fromEntries(Object.entries(data.value).filter(([key]) => {
        if (key !== section) {
          return true
        }
        return snapshot !== undefined
      }))
      if (snapshot !== undefined) {
        rolledBack[section] = snapshot
      }
      data.value = rolledBack
      toast.add({ title: 'Could not save the settings', color: 'error', icon: 'i-lucide-circle-alert' })
    }
  }

  return { data, save, refresh }
})

/** One section of the shared settings payload, with optimistic saves. */
export function useSettings<T extends object>(section: string) {
  const { data, save, refresh } = useSettingsState()

  return {
    data: computed(() => (data.value[section] ?? {}) as T),
    save: (value: T) => save(section, value),
    refresh
  }
}
