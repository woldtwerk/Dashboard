import { registerSettings } from '../../../core/server/utils/settings'
import { parseAssistantDomains } from '../mail-ai/assistant'
import { assistantSettingsSchema } from '../mail-ai/settings'

// Settings section `assistant`: which domains the chat assistant may read. The
// default is the runtime config, so nothing is sent beyond it until the user
// opts a domain in.
export default defineNitroPlugin(() => {
  registerSettings('assistant', assistantSettingsSchema, () => ({
    domains: parseAssistantDomains(useRuntimeConfig().assistant.domains)
  }))
})
