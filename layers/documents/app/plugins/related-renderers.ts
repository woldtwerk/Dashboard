import { provideRelatedRenderer } from '#layers/core/app/composables/useRelatedRenderers'
import DocumentsRelatedList from '../components/DocumentsRelatedList.vue'

// Related documents as thumbnails, correspondent vs. mention
export default defineNuxtPlugin(() => {
  provideRelatedRenderer('documents', DocumentsRelatedList)
})
