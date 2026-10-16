import { z } from 'zod'

/** A scalar or repeated query value; anything else is dropped by the zod pass. */
const scalar = z.union([z.string(), z.array(z.string())]).optional()

export const documentsServiceSchema = z.object({
  service: z.string().min(1)
})

/** Path/query ids are integers; never pass a string through to an upstream URL. */
export const documentsIdSchema = z.coerce.number().int().nonnegative()

export const documentsIdParamSchema = z.object({
  id: documentsIdSchema
})

export const documentsLinkIdParamSchema = z.object({
  id: documentsIdSchema,
  linkId: documentsIdSchema
})

/** `original=1` streams the original file, otherwise the archived (OCR) one. */
export const documentsDownloadQuerySchema = documentsServiceSchema.extend({
  original: z.stringbool().optional()
})

/** A Celery task id (hex/uuid) or a numeric id; only these reach the upstream URL. */
export const documentsTaskIdParamSchema = z.object({
  taskId: z.string().regex(/^[\w-]{1,128}$/)
})

/** The list query: only the known keys, each a plain string or list of strings. */
export const documentsListQuerySchema = documentsServiceSchema.extend({
  q: scalar,
  page: scalar,
  size: scalar,
  sort: scalar,
  order: scalar,
  mlt: scalar,
  tags: scalar,
  notTags: scalar,
  tagsMode: scalar,
  correspondent: scalar,
  type: scalar,
  path: scalar,
  field: scalar,
  fieldValue: scalar,
  createdAfter: scalar,
  createdBefore: scalar,
  addedAfter: scalar,
  addedBefore: scalar,
  asn: scalar,
  owner: scalar,
  inbox: scalar
})

const customFieldValue = z.object({
  field: z.number().int().nonnegative(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()])
})

export const documentsPatchSchema = z.object({
  title: z.string().trim().min(1).max(128).optional(),
  created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  correspondent: z.number().int().nonnegative().nullable().optional(),
  documentType: z.number().int().nonnegative().nullable().optional(),
  storagePath: z.number().int().nonnegative().nullable().optional(),
  tags: z.array(z.number().int().nonnegative()).max(1000).optional(),
  archiveSerialNumber: z.number().int().nonnegative().nullable().optional(),
  customFields: z.array(customFieldValue).max(1000).optional()
})

export const documentsIdsSchema = z.array(documentsIdSchema).min(1).max(1000)

export const documentsBulkEditSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('add_tag'), tag: documentsIdSchema }),
  z.object({ method: z.literal('remove_tag'), tag: documentsIdSchema }),
  z.object({ method: z.literal('set_correspondent'), correspondent: documentsIdSchema.nullable() }),
  z.object({ method: z.literal('set_document_type'), documentType: documentsIdSchema.nullable() }),
  z.object({ method: z.literal('set_storage_path'), storagePath: documentsIdSchema.nullable() }),
  z.object({ method: z.literal('delete') }),
  z.object({ method: z.literal('reprocess') }),
  z.object({ method: z.literal('rotate'), degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]) }),
  z.object({ method: z.literal('merge'), metadataDocumentId: documentsIdSchema.nullable().optional(), deleteOriginals: z.boolean().optional() })
])

export const documentsBulkEditBodySchema = z.object({
  documents: documentsIdsSchema,
  action: documentsBulkEditSchema
})

export const documentsBulkDownloadBodySchema = z.object({
  documents: documentsIdsSchema,
  content: z.enum(['archive', 'original', 'both']).default('archive'),
  compression: z.enum(['none', 'deflated']).default('none')
})

export const documentsNoteBodySchema = z.object({
  note: z.string().trim().min(1).max(10000)
})

export const documentsNoteQuerySchema = documentsServiceSchema.extend({
  noteId: documentsIdSchema
})

export const documentsShareLinkBodySchema = z.object({
  expiration: z.string().datetime().nullable().optional(),
  fileVersion: z.enum(['archive', 'original']).default('archive')
})

export const documentsTasksBodySchema = documentsIdsSchema

const matchingAlgorithm = z.number().int().min(0).max(6).optional()

export const documentsTagInputSchema = z.object({
  name: z.string().trim().min(1).max(128),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb colour').optional(),
  match: z.string().max(256).optional(),
  matchingAlgorithm,
  isInsensitive: z.boolean().optional(),
  isInboxTag: z.boolean().optional(),
  parent: documentsIdSchema.nullable().optional()
})

const namedInput = z.object({
  name: z.string().trim().min(1).max(128),
  match: z.string().max(256).optional(),
  matchingAlgorithm,
  isInsensitive: z.boolean().optional()
})

export const documentsCorrespondentInputSchema = namedInput
export const documentsDocumentTypeInputSchema = namedInput

export const documentsStoragePathInputSchema = namedInput.extend({
  path: z.string().trim().min(1).max(512)
})

export const documentsCustomFieldInputSchema = z.object({
  name: z.string().trim().min(1).max(128),
  dataType: z.enum(['string', 'url', 'date', 'boolean', 'integer', 'float', 'monetary', 'documentlink', 'select', 'longtext']),
  extraData: z.unknown().optional()
})

const dateRange = z.object({
  after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})

export const documentsFiltersSchema = z.object({
  tags: z.array(documentsIdSchema).max(1000).default([]),
  tagsExcluded: z.array(documentsIdSchema).max(1000).default([]),
  tagsMode: z.enum(['any', 'all']).default('any'),
  correspondent: documentsIdSchema.optional(),
  documentType: documentsIdSchema.optional(),
  storagePath: documentsIdSchema.optional(),
  customField: z.object({ field: documentsIdSchema, value: z.string().max(255) }).optional(),
  created: dateRange.default({}),
  added: dateRange.default({}),
  asn: documentsIdSchema.optional(),
  owner: documentsIdSchema.optional(),
  inbox: z.boolean().default(false)
})

const sortFieldSchema = z.enum([
  'added', 'created', 'modified', 'title', 'correspondent',
  'document_type', 'storage_path', 'archive_serial_number', 'id', 'page_count', 'score'
])

export const documentsSavedViewInputSchema = z.object({
  name: z.string().trim().min(1).max(128),
  icon: z.string().max(64).optional(),
  sort: sortFieldSchema.optional(),
  reverse: z.boolean().default(false),
  pageSize: z.number().int().positive().max(1000).nullable().optional(),
  displayMode: z.enum(['table', 'grid']).nullable().optional(),
  filters: documentsFiltersSchema
})
