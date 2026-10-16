import type { DocumentsFilterRule, DocumentsFilters } from '../../../documents/shared/types/documents'
import { EMPTY_DOCUMENTS_FILTERS } from '../../../documents/shared/types/documents'

/**
 * The Paperless-ngx `filter_rules` rule_type numbers this adapter understands
 * (see the API's `RuleTypeEnum`). Rules outside this set are kept raw on the
 * saved view but ignored when resolving the domain filters.
 */
export const PAPERLESS_RULE = {
  ASN: 2,
  CORRESPONDENT: 3,
  DOCUMENT_TYPE: 4,
  INBOX: 5,
  HAS_TAG: 6,
  HAS_ANY_TAG: 7,
  CREATED_BEFORE: 8,
  CREATED_AFTER: 9,
  ADDED_BEFORE: 13,
  ADDED_AFTER: 14,
  DOES_NOT_HAVE_TAG: 17,
  HAS_STORAGE_PATH: 25,
  OWNER: 32
} as const

function ids(value: string | null): number[] {
  if (!value) {
    return []
  }
  return value.split(',')
    .map(part => Number.parseInt(part.trim(), 10))
    .filter(part => Number.isInteger(part) && part >= 0)
}

function int(value: string | null): number | undefined {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function date(value: string | null): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) ? value.slice(0, 10) : undefined
}

/** The Paperless-ngx filter rules for a set of domain filters. */
export function filtersToRules(filters: DocumentsFilters): DocumentsFilterRule[] {
  const rules: DocumentsFilterRule[] = []

  if (filters.tags.length) {
    rules.push({ ruleType: filters.tagsMode === 'all' ? PAPERLESS_RULE.HAS_TAG : PAPERLESS_RULE.HAS_ANY_TAG, value: filters.tags.join(',') })
  }
  if (filters.tagsExcluded.length) {
    rules.push({ ruleType: PAPERLESS_RULE.DOES_NOT_HAVE_TAG, value: filters.tagsExcluded.join(',') })
  }
  if (filters.correspondent !== undefined) {
    rules.push({ ruleType: PAPERLESS_RULE.CORRESPONDENT, value: String(filters.correspondent) })
  }
  if (filters.documentType !== undefined) {
    rules.push({ ruleType: PAPERLESS_RULE.DOCUMENT_TYPE, value: String(filters.documentType) })
  }
  if (filters.storagePath !== undefined) {
    rules.push({ ruleType: PAPERLESS_RULE.HAS_STORAGE_PATH, value: String(filters.storagePath) })
  }
  if (filters.asn !== undefined) {
    rules.push({ ruleType: PAPERLESS_RULE.ASN, value: String(filters.asn) })
  }
  if (filters.owner !== undefined) {
    rules.push({ ruleType: PAPERLESS_RULE.OWNER, value: String(filters.owner) })
  }
  if (filters.inbox) {
    rules.push({ ruleType: PAPERLESS_RULE.INBOX, value: 'true' })
  }
  if (filters.created.after) {
    rules.push({ ruleType: PAPERLESS_RULE.CREATED_AFTER, value: filters.created.after })
  }
  if (filters.created.before) {
    rules.push({ ruleType: PAPERLESS_RULE.CREATED_BEFORE, value: filters.created.before })
  }
  if (filters.added.after) {
    rules.push({ ruleType: PAPERLESS_RULE.ADDED_AFTER, value: filters.added.after })
  }
  if (filters.added.before) {
    rules.push({ ruleType: PAPERLESS_RULE.ADDED_BEFORE, value: filters.added.before })
  }

  return rules
}

/** The domain filters a set of Paperless-ngx filter rules describes. */
export function rulesToFilters(rules: DocumentsFilterRule[]): DocumentsFilters {
  const filters: DocumentsFilters = { ...structuredClone(EMPTY_DOCUMENTS_FILTERS), tags: [], tagsExcluded: [] }

  for (const rule of rules) {
    switch (rule.ruleType) {
      case PAPERLESS_RULE.HAS_TAG:
        filters.tags = ids(rule.value)
        filters.tagsMode = 'all'
        break
      case PAPERLESS_RULE.HAS_ANY_TAG:
        filters.tags = ids(rule.value)
        filters.tagsMode = 'any'
        break
      case PAPERLESS_RULE.DOES_NOT_HAVE_TAG:
        filters.tagsExcluded = ids(rule.value)
        break
      case PAPERLESS_RULE.CORRESPONDENT:
        filters.correspondent = int(rule.value)
        break
      case PAPERLESS_RULE.DOCUMENT_TYPE:
        filters.documentType = int(rule.value)
        break
      case PAPERLESS_RULE.HAS_STORAGE_PATH:
        filters.storagePath = int(rule.value)
        break
      case PAPERLESS_RULE.ASN:
        filters.asn = int(rule.value)
        break
      case PAPERLESS_RULE.OWNER:
        filters.owner = int(rule.value)
        break
      case PAPERLESS_RULE.INBOX:
        filters.inbox = rule.value === 'true' || rule.value === '1'
        break
      case PAPERLESS_RULE.CREATED_AFTER:
        filters.created.after = date(rule.value)
        break
      case PAPERLESS_RULE.CREATED_BEFORE:
        filters.created.before = date(rule.value)
        break
      case PAPERLESS_RULE.ADDED_AFTER:
        filters.added.after = date(rule.value)
        break
      case PAPERLESS_RULE.ADDED_BEFORE:
        filters.added.before = date(rule.value)
        break
    }
  }

  return filters
}
