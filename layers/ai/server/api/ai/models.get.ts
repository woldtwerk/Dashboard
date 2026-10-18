import { defineEventHandler } from 'nuxt/server'

// Models per configured AI service, for the model select; a failing service is reported in its entry
export default defineEventHandler(() => listAiServiceModels())
