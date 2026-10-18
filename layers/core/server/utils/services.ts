import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { createHooks } from 'hookable'
import { createError, deriveSecret } from 'nuxt/server'
import { z } from 'zod'
import type { ConnectorInfo, ServiceInfo, SetupField, SetupOption, SetupState, SetupValues, SetupWizard } from '../../shared/types/setup'
import { deleteService, findService, findServices, upsertService } from '../db/service-repository'
import type { ServiceRow } from '../db/service-repository'

export interface ConnectorTestContext {
  /** The stored service being re-tested; absent for a wizard's first test */
  serviceId?: string
}

export interface Connector extends ConnectorInfo {
  wizard: SetupWizard
  /** Cross-field checks; return an error message to reject the values */
  validate?: (values: SetupValues) => string | undefined
  /** Fill values only the server can know, e.g. a secret fetched from a helper service; runs before `validate` */
  complete?: (values: SetupValues) => Promise<SetupValues>
  /** Verify the values work, e.g. by connecting; throw to reject */
  test?: (values: SetupValues, context?: ConnectorTestContext) => Promise<void>
  /** Options of a dynamic select field, e.g. the models an endpoint offers */
  fieldOptions?: (field: string, values: SetupValues) => Promise<SetupOption[]>
}

export interface Service extends ServiceInfo {
  values: SetupValues
}

const connectors = new Map<string, Connector>()

export interface ServiceHooks {
  /** After a service was deleted, e.g. to clean up data derived from it */
  removed: (service: ServiceInfo) => void | Promise<void>
}

/** Lifecycle hooks for domain layers; register in a Nitro plugin */
export const serviceHooks = createHooks<ServiceHooks>()

export function registerConnector(connector: Connector) {
  connectors.set(connector.id, connector)
}

export function listConnectors(): ConnectorInfo[] {
  return [...connectors.values()].map(toConnectorInfo)
}

export function getConnector(id: string): Connector {
  const connector = connectors.get(id)
  if (!connector) {
    throw createError({ status: 404, statusText: `Unknown connector "${id}"` })
  }
  return connector
}

function toConnectorInfo({ id, domain, title, description, icon }: Connector): ConnectorInfo {
  return { id, domain, title, description, icon }
}

// --- Encryption at rest ---

async function getKey(): Promise<Buffer> {
  return Buffer.from(await deriveSecret('allmight:services'), 'hex')
}

async function encrypt(values: SetupValues): Promise<string> {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', await getKey(), iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(values), 'utf8'), cipher.final()])

  return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64')).join('.')
}

async function decrypt(payload: string): Promise<SetupValues> {
  const [iv, tag, data] = payload.split('.').map(part => Buffer.from(part, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', await getKey(), iv!)
  decipher.setAuthTag(tag!)

  return JSON.parse(Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8'))
}

// --- Service instances ---

function toServiceInfo({ id, connector, domain, name, icon }: ServiceRow): ServiceInfo {
  return { id, connector, domain, name, icon: icon ?? undefined }
}

export async function listServices(domain?: string): Promise<ServiceInfo[]> {
  return (await findServices(await useDb(), domain)).map(toServiceInfo)
}

export async function getService(id: string, domain?: string): Promise<Service> {
  const row = await findService(await useDb(), id)

  if (!row || (domain && row.domain !== domain)) {
    throw createError({ status: 404, statusText: 'Service not found' })
  }

  try {
    return { ...toServiceInfo(row), values: await decrypt(row.settings) }
  } catch {
    // e.g. NUXT_APP_SECRET changed
    throw createError({ status: 500, statusText: `Settings of "${row.name}" cannot be decrypted. Set the service up again.` })
  }
}

/** Reject a loaded service that belongs to another connector than the request names */
export function assertSameConnector(service: Service | undefined, connectorId: string) {
  if (service && service.connector !== connectorId) {
    throw createError({ status: 400, statusText: 'The service belongs to another connector' })
  }
}

export async function saveService(input: { id?: string, connector: Connector, name: string, values: SetupValues }): Promise<ServiceInfo> {
  const row = await upsertService(await useDb(), {
    id: input.id ?? randomUUID(),
    connector: input.connector.id,
    domain: input.connector.domain,
    icon: input.connector.icon ?? null,
    name: input.name,
    settings: await encrypt(input.values)
  })

  return toServiceInfo(row)
}

/** No decryption needed, so even unreadable services can be removed */
export async function removeService(id: string) {
  const deleted = await deleteService(await useDb(), id)
  if (!deleted) {
    throw createError({ status: 404, statusText: 'Service not found' })
  }
  await serviceHooks.callHook('removed', toServiceInfo(deleted))
}

// --- Wizard ---

function fieldsOf(wizard: SetupWizard): SetupField[] {
  return wizard.steps.flatMap(step => step.fields ?? [])
}

export function getSetupState(connector: Connector, service?: Service): SetupState {
  const fields = fieldsOf(connector.wizard)
  const values: SetupValues = {}
  const storedSecrets: string[] = []

  for (const field of fields) {
    const value = service ? service.values[field.name] : field.default
    if (field.secret) {
      if (value !== undefined && value !== '') {
        storedSecrets.push(field.name)
      }
    } else {
      values[field.name] = value
    }
  }

  return {
    connector: toConnectorInfo(connector),
    wizard: connector.wizard,
    service: service && { id: service.id, connector: service.connector, domain: service.domain, name: service.name, icon: service.icon },
    values,
    storedSecrets
  }
}

function fieldSchema(field: SetupField): z.ZodType<SetupValue | undefined> {
  switch (field.type) {
    case 'number': {
      let schema = z.coerce.number()
      if (field.min !== undefined) schema = schema.min(field.min)
      if (field.max !== undefined) schema = schema.max(field.max)
      return field.required ? schema : schema.optional()
    }
    case 'switch':
      return z.boolean().default(field.default ?? false)
    case 'select': {
      const allowed = field.options?.length && !field.allowCustom
        ? new Set(field.options.map(option => option.value))
        : undefined

      if (field.required && !field.secret) {
        const required = z.string().trim().min(1, `${field.label} is required`)
        return allowed ? required.refine(value => allowed.has(value), `${field.label} must be one of the offered options`) : required
      }

      const schema = z.string().trim().optional()
      return allowed ? schema.refine(value => value === undefined || value === '' || allowed.has(value), `${field.label} must be one of the offered options`) : schema
    }
    default: {
      const schema = z.string().trim()
      // Secrets may be left empty to keep the stored value; checked after merging
      return field.required && !field.secret ? schema.min(1, `${field.label} is required`) : schema.optional()
    }
  }
}

export const setupBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  values: z.record(z.string(), z.unknown())
})

/**
 * Fill empty secret fields from the stored service, but only while every
 * `bindSecretsTo` field is unchanged. Lenient by design: no required checks,
 * no `complete`/`validate`, so a dynamic field can ask for options before the
 * wizard has been submitted.
 */
export function mergeStoredSecrets(connector: Connector, input: SetupValues, service?: Service): SetupValues {
  const values: SetupValues = { ...input }
  const sameTarget = !!service && (connector.wizard.bindSecretsTo ?? []).every(name => values[name] === service.values[name])

  if (!sameTarget) {
    return values
  }

  for (const field of fieldsOf(connector.wizard)) {
    if (field.secret && !values[field.name]) {
      values[field.name] = service!.values[field.name]
    }
  }

  return values
}

/** Validate wizard input against the connector schema and merge it with the stored values. */
export async function resolveSetupValues(connector: Connector, input: Record<string, unknown>, service?: Service): Promise<SetupValues> {
  const fields = fieldsOf(connector.wizard)
  const result = z.object(Object.fromEntries(fields.map(field => [field.name, fieldSchema(field)]))).safeParse(input)

  if (!result.success) {
    throw createError({ status: 400, statusText: result.error.issues[0]?.message ?? 'Invalid settings' })
  }

  let values = mergeStoredSecrets(connector, result.data, service)

  for (const field of fields) {
    if (field.secret && field.required && !values[field.name]) {
      throw createError({ status: 400, statusText: `${field.label} is required` })
    }
  }

  if (connector.complete) {
    values = await connector.complete(values)
  }

  const error = connector.validate?.(values)
  if (error) {
    throw createError({ status: 400, statusText: error })
  }

  return values
}
