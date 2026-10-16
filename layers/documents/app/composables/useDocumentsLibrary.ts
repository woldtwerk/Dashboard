import type { Ref } from 'vue'
import type {
  DocumentsCorrespondent,
  DocumentsCustomField,
  DocumentsDocumentType,
  DocumentsSavedView,
  DocumentsStoragePath,
  DocumentsTag
} from '#layers/documents/shared/types/documents'

/**
 * The archive's reference data for one service: tags, correspondents, document
 * types, storage paths, custom fields and saved views. Fetched lazily, so a page
 * that already knows which service it shows can kick it off with `load()`.
 */
export function useDocumentsLibrary(service: Ref<string>) {
  const query = computed(() => ({ service: service.value }))
  const key = (name: string) => () => `documents:${name}:${service.value}`
  const options = { query, default: () => [], immediate: false } as const

  const tags = useFetch<DocumentsTag[]>('/api/documents/tags', { ...options, key: key('tags') })
  const correspondents = useFetch<DocumentsCorrespondent[]>('/api/documents/correspondents', { ...options, key: key('correspondents') })
  const documentTypes = useFetch<DocumentsDocumentType[]>('/api/documents/document-types', { ...options, key: key('document-types') })
  const storagePaths = useFetch<DocumentsStoragePath[]>('/api/documents/storage-paths', { ...options, key: key('storage-paths') })
  const customFields = useFetch<DocumentsCustomField[]>('/api/documents/custom-fields', { ...options, key: key('custom-fields') })
  const savedViews = useFetch<DocumentsSavedView[]>('/api/documents/saved-views', { ...options, key: key('saved-views') })

  // Unwrapped lists, so components can pass them straight to props
  const tagList = computed(() => tags.data.value)
  const correspondentList = computed(() => correspondents.data.value)
  const documentTypeList = computed(() => documentTypes.data.value)
  const storagePathList = computed(() => storagePaths.data.value)
  const customFieldList = computed(() => customFields.data.value)
  const savedViewList = computed(() => savedViews.data.value)

  function load() {
    if (!service.value) {
      return Promise.resolve()
    }
    return Promise.all([
      tags.refresh(),
      correspondents.refresh(),
      documentTypes.refresh(),
      storagePaths.refresh(),
      customFields.refresh(),
      savedViews.refresh()
    ])
  }

  return {
    tags,
    correspondents,
    documentTypes,
    storagePaths,
    customFields,
    savedViews,
    tagList,
    correspondentList,
    documentTypeList,
    storagePathList,
    customFieldList,
    savedViewList,
    load
  }
}

/** The name of `id` in `items`, used to label filters, chips and cards. */
export function documentsName(items: { id: number, name: string }[], id: number | null | undefined): string {
  if (id === null || id === undefined) {
    return ''
  }
  return items.find(item => item.id === id)?.name ?? `#${id}`
}
