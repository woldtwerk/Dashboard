import { Meilisearch } from 'meilisearch'
import type { EnqueuedTaskPromise } from 'meilisearch'
import type { MailDocument, MailIndexQuery, MailSearchIndex } from '../../../mail/server/utils/mail-search-index'
import type { MailSummary } from '../../../mail/shared/types/mail'
import { buildMailFilter } from './query'

export interface MeilisearchMailIndexOptions {
  host: string
  apiKey: string
  index: string
  embedderModel: string
  semanticRatio: number
  rankingScoreThreshold: number
}

const EMBEDDER = 'default'
/** The first settings update downloads the embedding model */
const SETTINGS_TIMEOUT_MS = 15 * 60_000
/** Adding documents includes computing their embeddings on the CPU */
const DOCUMENTS_TIMEOUT_MS = 5 * 60_000

/** Waits for a Meilisearch task and fails when the task failed */
async function settle(task: EnqueuedTaskPromise, timeout = DOCUMENTS_TIMEOUT_MS) {
  const result = await task.waitTask({ timeout })
  if (result.status !== 'succeeded') {
    throw new Error(`Meilisearch task ${result.uid} ${result.status}: ${result.error?.message ?? 'unknown error'}`)
  }
}

export function createMeilisearchMailIndex(options: MeilisearchMailIndexOptions): MailSearchIndex {
  const client = new Meilisearch({ host: options.host, apiKey: options.apiKey })
  const index = client.index<MailDocument>(options.index)
  const semantic = !!options.embedderModel

  // Settings are idempotent; applied once per worker before the first write or search
  let ready: Promise<void> | undefined
  const ensureSettings = () => ready ??= (async () => {
    // Fails harmlessly when the index exists
    await client.createIndex(options.index, { primaryKey: 'id' }).waitTask().catch(() => {})
    await settle(index.updateSettings({
      searchableAttributes: ['subject', 'fromText', 'toText', 'text'],
      filterableAttributes: ['service', 'mailbox', 'unread', 'flagged', 'date', 'fromTerms'],
      sortableAttributes: ['date'],
      // The same mail in several folders/labels is shown once
      distinctAttribute: 'messageId',
      embedders: semantic
        ? {
            [EMBEDDER]: {
              source: 'huggingFace',
              model: options.embedderModel,
              documentTemplate: 'From: {{doc.fromText}}\nSubject: {{doc.subject}}\n{{doc.text}}',
              documentTemplateMaxBytes: 1000
            }
          }
        : {}
    }), SETTINGS_TIMEOUT_MS)
  })().catch((error) => {
    ready = undefined
    throw error
  })

  return {
    async upsert(documents) {
      if (!documents.length) return
      await ensureSettings()
      await settle(index.addDocuments(documents, { primaryKey: 'id' }))
    },

    async updateFlags(updates) {
      if (!updates.length) return
      await ensureSettings()
      await settle(index.updateDocuments(updates))
    },

    async remove(ids) {
      if (!ids.length) return
      await ensureSettings()
      await settle(index.deleteDocuments(ids))
    },

    async removeMailbox(service, mailbox) {
      await ensureSettings()
      await settle(index.deleteDocuments({ filter: buildMailFilter({ services: [service], mailbox, search: {} }) }))
    },

    async search({ services, mailbox, search, limit }: MailIndexQuery): Promise<MailSummary[]> {
      await ensureSettings()
      const text = search.text?.trim()
      const result = await index.search(text || null, {
        filter: buildMailFilter({ services, mailbox, search }),
        limit,
        // Without text, browse newest first; with text, rank by relevance
        sort: text ? undefined : ['date:desc'],
        hybrid: text && semantic ? { embedder: EMBEDDER, semanticRatio: options.semanticRatio } : undefined,
        rankingScoreThreshold: text ? options.rankingScoreThreshold : undefined,
        attributesToRetrieve: ['service', 'mailbox', 'uid', 'subject', 'fromList', 'date', 'unread', 'flagged'],
        attributesToCrop: text ? ['text'] : undefined,
        cropLength: 24
      })

      return result.hits.map(hit => ({
        uid: hit.uid,
        service: hit.service,
        mailbox: hit.mailbox,
        subject: hit.subject,
        from: hit.fromList,
        date: new Date(hit.date * 1000).toISOString(),
        unread: hit.unread,
        flagged: hit.flagged,
        snippet: hit._formatted?.text || undefined
      }))
    }
  }
}
