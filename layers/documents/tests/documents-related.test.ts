import { describe, expect, it } from 'vitest'
import { documentRelationBadge } from '../app/utils/documents-related'

describe('documentRelationBadge', () => {
  it('marks a correspondent as the stronger link', () => {
    expect(documentRelationBadge('correspondent')).toEqual({ label: 'Correspondent', color: 'primary' })
  })

  it('falls back to mentioned for anything weaker', () => {
    expect(documentRelationBadge('mentions')).toEqual({ label: 'Mentioned', color: 'neutral' })
    expect(documentRelationBadge('attachment')).toEqual({ label: 'Mentioned', color: 'neutral' })
  })
})
