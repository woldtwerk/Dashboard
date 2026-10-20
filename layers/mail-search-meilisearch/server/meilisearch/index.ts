import { Meilisearch } from 'meilisearch'
import type { EnqueuedTaskPromise } from 'meilisearch'
import type { MailDocument, MailFacetQuery, MailIndexQuery, MailSearchIndex } from '../../../mail/server/utils/mail-search-index'
import type { MailFacets, MailSummary } from '../../../mail/shared/types/mail'
import { buildMailFilter, dayCountQueries } from './query'
import { buildIndexSettings, EMBEDDER, HIGHLIGHT_POST_TAG, HIGHLIGHT_PRE_TAG, rankingScoreThresholdFor } from './settings'

export interface MeilisearchMailIndexOptions {
  host: string
  apiKey: string
  index: string
  embedderModel: string
  semanticRatio: number
  rankingScoreThreshold: number
  typoTolerance: boolean
  typoOneTypo: number
  typoTwoTypos: number
  typoDisableOnNumbers: boolean
  typoDisableOnAttributes: string[]
}

/** How many senders the `from` control offers */
const FACET_LIMIT = 20

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
    // `updateSettings` patches an existing index as well as a new one, so a
    // setting added in a later version reaches the index on the next worker start
    await settle(index.updateSettings(buildIndexSettings({
      semantic,
      embedderModel: options.embedderModel,
      typoTolerance: options.typoTolerance,
      typoOneTypo: options.typoOneTypo,
      typoTwoTypos: options.typoTwoTypos,
      typoDisableOnNumbers: options.typoDisableOnNumbers,
      typoDisableOnAttributes: options.typoDisableOnAttributes
    })), SETTINGS_TIMEOUT_MS)
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

    async updateDocuments(updates) {
      if (!updates.length) return
      await ensureSettings()
      await settle(index.updateDocuments(updates))
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

    async search({ services, mailbox, mailboxes, participant, conversationKeys, search, limit, offset, globalSearch }: MailIndexQuery): Promise<MailSummary[]> {
      await ensureSettings()
      const text = search.text?.trim()
      const result = await index.search(text || null, {
        filter: buildMailFilter({ services, mailbox, mailboxes, participant, conversationKeys, search }),
        limit,
        offset,
        // Without text, browse newest first; with text, rank by relevance
        sort: text ? undefined : ['date:desc'],
        hybrid: text && semantic ? { embedder: EMBEDDER, semanticRatio: options.semanticRatio } : undefined,
        rankingScoreThreshold: text ? rankingScoreThresholdFor(semantic, options.semanticRatio, options.rankingScoreThreshold) : undefined,
        // The palette decides keyword vs semantic from the markers and needs the score
        showRankingScore: globalSearch ? true : undefined,
        attributesToRetrieve: ['service', 'mailbox', 'uid', 'subject', 'fromList', 'toList', 'ccList', 'date', 'unread', 'flagged', 'hasAttachment', 'conversationKeys', 'listId', 'listName'],
        attributesToCrop: text ? ['text'] : undefined,
        cropLength: globalSearch ? 20 : 24,
        // Highlighted matches come back as marker-tagged strings the client escapes before rendering
        attributesToHighlight: text ? (globalSearch ? ['subject', 'fromText', 'text'] : ['subject', 'text']) : undefined,
        highlightPreTag: HIGHLIGHT_PRE_TAG,
        highlightPostTag: HIGHLIGHT_POST_TAG
      })

      return result.hits.map(hit => ({
        uid: hit.uid,
        service: hit.service,
        mailbox: hit.mailbox,
        subject: hit.subject,
        subjectHighlight: hit._formatted?.subject,
        fromHighlight: hit._formatted?.fromText,
        from: hit.fromList,
        to: hit.toList,
        cc: hit.ccList,
        date: new Date(hit.date * 1000).toISOString(),
        unread: hit.unread,
        flagged: hit.flagged,
        hasAttachment: hit.hasAttachment,
        conversationKeys: hit.conversationKeys,
        listId: hit.listId,
        listName: hit.listName,
        rankingScore: hit._rankingScore,
        snippet: hit._formatted?.text || undefined
      }))
    },

    async facets({ services, mailbox, search }: MailFacetQuery): Promise<MailFacets> {
      await ensureSettings()
      const text = search.text?.trim()
      const result = await index.search(text || null, {
        filter: buildMailFilter({ services, mailbox, search }),
        limit: 0,
        facets: ['fromTerms'],
        attributesToRetrieve: []
      })

      const distribution = result.facetDistribution?.fromTerms ?? {}

      return {
        from: Object.entries(distribution)
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, FACET_LIMIT)
      }
    },

    async countByDay({ services, since, until }) {
      const days = dayCountQueries(since, until, services)
      if (!days.length || !services.length) {
        return []
      }

      await ensureSettings()
      const result = await client.multiSearch({
        queries: days.map(day => ({
          indexUid: options.index,
          filter: day.filter,
          limit: 0,
          attributesToRetrieve: []
        }))
      })

      return days.map((day, index) => ({
        date: day.date,
        count: result.results[index]?.estimatedTotalHits ?? 0
      }))
    }
  }
}
