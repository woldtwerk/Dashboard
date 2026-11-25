import { z } from 'zod'
import { listDomainTools } from '../../../core/server/utils/domain-tools'

/**
 * Settings section `assistant`. Every name must be a domain that actually
 * registers tools; the domains are read at parse time, so a layer's tools are
 * already registered when the API validates a save.
 */
export const assistantSettingsSchema = z.object({
  domains: z.array(z.string().trim().min(1)).superRefine((domains, context) => {
    const known = new Set(listDomainTools().map(tool => tool.domain))

    for (const domain of domains) {
      if (!known.has(domain)) {
        context.addIssue({
          code: 'custom',
          message: `"${domain}" is not a domain with tools`
        })
      }
    }
  }),
  // A saved model may name a service or model that no longer exists; resolving
  // it falls back to the first service's default without rejecting the section.
  model: z.object({
    serviceId: z.string().trim().min(1).max(100),
    modelId: z.string().trim().min(1).max(200)
  }).nullable()
})
