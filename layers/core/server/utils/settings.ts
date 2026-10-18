import { eq } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { z } from 'zod'
import { userSettings } from '../db/schema'
import { publishDomainEvent } from './domain-events'

type SettingsObject = Record<string, unknown>
type SettingsDefaults = SettingsObject | (() => SettingsObject)

export interface SettingsSectionDefinition {
  schema: z.ZodObject<z.ZodRawShape>
  defaults: SettingsDefaults
}

const sections = new Map<string, SettingsSectionDefinition>()

/**
 * Registers one settings section. Domains own their schema and defaults; the
 * core layer only stores and serves the sections. Call from a Nitro plugin.
 */
export function registerSettings<T extends z.ZodObject<z.ZodRawShape>>(
  section: string,
  schema: T,
  defaults: z.output<T> | (() => z.output<T>)
): void {
  sections.set(section, {
    schema,
    defaults: defaults as SettingsDefaults
  })
}

export function getSettingsDefinition(section: string): SettingsSectionDefinition | undefined {
  return sections.get(section)
}

export function hasSettingsSection(section: string): boolean {
  return sections.has(section)
}

export function listSettingsSections(): string[] {
  return [...sections.keys()]
}

function requireSettings(section: string): SettingsSectionDefinition {
  const definition = sections.get(section)
  if (!definition) {
    throw createError({ status: 404, statusText: `Unknown settings section "${section}"` })
  }
  return definition
}

function resolvedDefaults(definition: SettingsSectionDefinition): SettingsObject {
  return typeof definition.defaults === 'function' ? definition.defaults() : definition.defaults
}

function isRecord(value: unknown): value is SettingsObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Recursively applies a stored object over defaults; arrays and scalars replace. */
function mergeSettings(defaults: SettingsObject, stored: SettingsObject): SettingsObject {
  const merged: SettingsObject = { ...defaults }

  for (const [key, value] of Object.entries(stored)) {
    const base = merged[key]
    merged[key] = isRecord(base) && isRecord(value) ? mergeSettings(base, value) : value
  }

  return merged
}

/**
 * Applies a stored section over its defaults and validates the result. A stored
 * value that no longer fits the schema (an old shape, a removed option) falls
 * back to the defaults instead of breaking the page.
 */
export function settingsFromStored(section: string, stored: unknown): SettingsObject {
  const definition = requireSettings(section)
  const defaults = resolvedDefaults(definition)

  if (stored !== undefined && !isRecord(stored)) {
    console.warn(`[settings] Stored value of "${section}" is not a settings object; using defaults`)
  }

  const merged = isRecord(stored) ? mergeSettings(defaults, stored) : defaults
  const parsed = definition.schema.safeParse(merged)

  if (parsed.success) {
    return parsed.data as SettingsObject
  }

  console.warn(`[settings] Stored value of "${section}" is invalid; using defaults`, parsed.error.issues[0]?.message)

  const fallback = definition.schema.safeParse(defaults)
  return (fallback.success ? fallback.data : defaults) as SettingsObject
}

/** Validates a section value; the API and `saveSettings` both use this. */
export function parseSettings(section: string, value: unknown) {
  return requireSettings(section).schema.safeParse(value)
}

/** The stored settings of a section, merged over its defaults. */
export async function getSettings<T = SettingsObject>(section: string): Promise<T> {
  requireSettings(section)
  const db = await useDb()
  const row = await db.select({ value: userSettings.value }).from(userSettings)
    .where(eq(userSettings.key, section))
    .get()

  let stored: unknown
  if (row) {
    try {
      stored = JSON.parse(row.value)
    } catch {
      console.warn(`[settings] Stored value of "${section}" is not valid JSON; using defaults`)
    }
  }

  return settingsFromStored(section, stored) as T
}

/** Validates, stores and announces a section; the returned value is the parsed one. */
export async function saveSettings<T extends SettingsObject = SettingsObject>(section: string, value: T): Promise<T> {
  const parsed = parseSettings(section, value)
  if (!parsed.success) {
    throw createError({
      status: 400,
      statusText: parsed.error.issues[0]?.message ?? `Invalid settings for "${section}"`
    })
  }

  const now = new Date()
  const encoded = JSON.stringify(parsed.data)
  const db = await useDb()

  await db.insert(userSettings)
    .values({ key: section, value: encoded, updatedAt: now })
    .onConflictDoUpdate({
      target: userSettings.key,
      set: { value: encoded, updatedAt: now }
    })

  await publishDomainEvent({ domain: 'core', service: 'core', type: 'changed', resource: `settings:${section}` })

  return parsed.data as T
}
