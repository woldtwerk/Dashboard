import type { MailSearch } from '#layers/mail/shared/types/mail'

// Offers "turn into filters" in the mail search once an AI service exists
export default defineNuxtPlugin(() => {
  defineMailSearchAssistant({
    label: 'Turn into filters with AI',
    icon: 'i-lucide-sparkles',
    isAvailable: services => services.some(service => service.domain === 'ai'),
    toSearch: text => $fetch<MailSearch>('/api/mail/ai/search', { method: 'POST', body: { text } })
  })
})
