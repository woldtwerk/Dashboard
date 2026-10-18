import { describe, expect, it } from 'vitest'
import { mailListSource } from '../server/utils/mail-list-source'

describe('mailListSource', () => {
  it('uses the index for plain browsing of an indexed folder', () => {
    expect(mailListSource({ indexAvailable: true, indexed: true, allFolders: false, hasCriteria: false })).toBe('index')
  })

  it('falls back to the provider while a folder is not indexed yet', () => {
    expect(mailListSource({ indexAvailable: true, indexed: false, allFolders: false, hasCriteria: false })).toBe('provider')
  })

  it('uses the index for all-folder and search requests once indexed', () => {
    expect(mailListSource({ indexAvailable: true, indexed: true, allFolders: true, hasCriteria: false })).toBe('index')
    expect(mailListSource({ indexAvailable: true, indexed: true, allFolders: false, hasCriteria: true })).toBe('index')
  })

  it('falls back to the provider without an index', () => {
    expect(mailListSource({ indexAvailable: false, indexed: false, allFolders: true, hasCriteria: true })).toBe('provider')
    expect(mailListSource({ indexAvailable: false, indexed: false, allFolders: false, hasCriteria: false })).toBe('provider')
  })
})
