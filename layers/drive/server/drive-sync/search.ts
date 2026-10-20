import {
  DRIVE_MY_FILES_ROOT,
  DRIVE_SHARED_ROOT,
  breadcrumbs,
  isWithinPath,
  normalizePath
} from '../../shared/drive-path'

/** More terms than this make a query too narrow to be useful, and the SQL too wide. */
const MAX_SEARCH_TERMS = 8

/** Folds case and diacritics into the form both the index and the query use. */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en')
}

/** The normalized words of a query, without duplicates and capped at 8. */
export function searchTerms(query: string): string[] {
  return [...new Set(normalizeSearchText(query).split(/\s+/).filter(Boolean))].slice(0, MAX_SEARCH_TERMS)
}

/** Escapes the LIKE wildcards, for use with `ESCAPE '\'`. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&')
}

/**
 * The folder a hit lives in, as the palette shows it: My files paths lose the
 * `/my-files` root, shared folders keep a `Shared/...` prefix.
 */
export function searchParentLabel(parent: string): string {
  const path = normalizePath(parent)
  const names = breadcrumbs(path).map(crumb => crumb.name)

  if (isWithinPath(DRIVE_MY_FILES_ROOT, path)) {
    const rest = names.slice(1)
    return rest.length ? `/${rest.join('/')}` : '/'
  }

  if (isWithinPath(DRIVE_SHARED_ROOT, path)) {
    return ['Shared', ...names.slice(1)].join('/')
  }

  return path
}
