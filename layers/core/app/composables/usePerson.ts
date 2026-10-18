import type { MaybeRefOrGetter } from 'vue'
import type { Person } from '#layers/core/shared/types/entities'

/**
 * The person behind an email address. A missing person is a 404, not an error
 * worth showing: the caller falls back to the bare address.
 */
export function usePerson(email: MaybeRefOrGetter<string>) {
  return useFetch<Person | null>(() => `/api/people/${encodeURIComponent(toValue(email))}` as string, {
    key: () => `person:${toValue(email)}`,
    lazy: true,
    default: () => null
  })
}
