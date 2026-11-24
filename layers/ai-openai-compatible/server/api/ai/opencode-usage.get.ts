import { defineEventHandler } from 'nuxt/server'
import type { OpenCodeAccountUsage } from '../../../shared/opencode-usage'
import { safeErrorMessage } from '../../../../core/server/utils/errors'
import { openCodeAccountUsage } from '../../openai-compatible/usage'

// Credits and plan usage of every OpenCode service, for the home page widget.
// One unreachable service doesn't break the others.
export default defineEventHandler(async (): Promise<OpenCodeAccountUsage[]> => {
  const services = (await listServices('ai')).filter(service => service.connector === 'opencode')

  return Promise.all(services.map(async (info): Promise<OpenCodeAccountUsage> => {
    try {
      return await openCodeAccountUsage(await getService(info.id, 'ai'))
    } catch (error) {
      return {
        serviceId: info.id,
        serviceName: info.name,
        meters: [],
        error: safeErrorMessage(error, 'OpenCode usage could not be loaded')
      }
    }
  }))
})
