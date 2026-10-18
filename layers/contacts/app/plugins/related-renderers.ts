import { provideRelatedRenderer } from '#layers/core/app/composables/useRelatedRenderers'
import ContactRelatedCard from '../components/ContactRelatedCard.vue'

// A person's contact card is edited inline in the related panel
export default defineNuxtPlugin(() => {
  provideRelatedRenderer('contacts', ContactRelatedCard)
})
