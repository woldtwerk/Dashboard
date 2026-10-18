import type { SetupOption, SetupValue, SetupValues } from '#layers/core/shared/types/setup'

/**
 * Whether a dynamic field's dependencies are filled yet. A stored secret counts
 * as filled: the wizard knows it exists from `storedSecrets`, even though its
 * value never left the server.
 */
export function dependenciesReady(
  field: { dependsOn?: string[] },
  values: SetupValues,
  storedSecrets: string[] = []
): boolean {
  return (field.dependsOn ?? []).every((name) => {
    const value = values[name]
    return (value !== undefined && value !== '') || storedSecrets.includes(name)
  })
}

/** Prepend the current value when the fetched options do not contain it, so it stays selectable. */
export function withCurrentOption(options: SetupOption[], value: SetupValue | undefined): SetupOption[] {
  const current = value === undefined || value === '' ? undefined : String(value)
  if (!current || options.some(option => option.value === current)) {
    return options
  }
  return [{ label: current, value: current }, ...options]
}
