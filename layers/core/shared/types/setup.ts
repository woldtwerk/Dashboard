/**
 * Declarative setup wizard schema. Connectors (service types) define one and register it
 * on the server with `registerConnector()`; the core layer renders it generically.
 * The schema is plain data, so it can be sent to the client as is.
 */

export type SetupValue = string | number | boolean
export type SetupValues = Record<string, SetupValue | undefined>

interface SetupFieldBase {
  name: string
  label: string
  description?: string
  required?: boolean
  /** Never sent to the client. Left empty, the stored value is kept. */
  secret?: boolean
  /**
   * Global component a domain layer provides to render this one field instead
   * of the default input, e.g. a QR scanner. Gets `modelValue` and `field`,
   * emits `update:modelValue`. The field's `type` still describes the value.
   */
  component?: string
}

export interface SetupOption {
  label: string
  value: string
  description?: string
}

export type SetupField
  = | (SetupFieldBase & { type: 'text' | 'password' | 'textarea', placeholder?: string, autocomplete?: string, default?: string })
    | (SetupFieldBase & { type: 'number', min?: number, max?: number, default?: number })
    | (SetupFieldBase & { type: 'switch', default?: boolean })
    /** Text file (e.g. a certificate): uploaded or pasted, stored as text */
    | (SetupFieldBase & { type: 'file', accept?: string, placeholder?: string, default?: string })
    | (SetupFieldBase & {
      type: 'select'
      /** Static options */
      options?: SetupOption[]
      /** Options come from the connector's `fieldOptions` on the server */
      dynamic?: boolean
      /** Reload dynamic options when one of these fields changes; options load only once they are all filled */
      dependsOn?: string[]
      /** Accept a value that is not in the list */
      allowCustom?: boolean
      placeholder?: string
      default?: string
    })

export interface SetupStep {
  id: string
  title: string
  description?: string
  icon?: string
  intro?: string
  instructions?: string[]
  links?: { label: string, to: string }[]
  fields?: SetupField[]
  /**
   * Global component a domain layer provides to render this step instead of its fields,
   * e.g. a sign-in. Gets `values`, emits `update:values` with the fields it sets.
   */
  component?: string
}

export interface SetupWizard {
  steps: SetupStep[]
  /** Stored secrets are only reused while these fields are unchanged */
  bindSecretsTo?: string[]
}

/** A service type, e.g. Proton Mail */
export interface ConnectorInfo {
  id: string
  /** Domain the connector feeds, e.g. `mail` */
  domain: string
  title: string
  description?: string
  icon?: string
}

/** A configured service instance, e.g. one Proton account */
export interface ServiceInfo {
  id: string
  connector: string
  domain: string
  name: string
  icon?: string
}

/** What the wizard gets: schema plus current values, without secrets */
export interface SetupState {
  connector: ConnectorInfo
  wizard: SetupWizard
  service?: ServiceInfo
  values: SetupValues
  storedSecrets: string[]
}
