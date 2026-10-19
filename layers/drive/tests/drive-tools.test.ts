import { describe, expect, it } from 'vitest'
import { driveInfoSources, driveListSources } from '../server/tools'

describe('drive tool sources', () => {
  const file = {
    uid: 'entry-1',
    name: 'report.pdf',
    type: 'file' as const,
    parent: '/Docs',
    path: '/Docs/report.pdf',
    size: 1024,
    modified: '2026-10-01T09:00:00Z',
    mediaType: 'application/pdf'
  }

  it('maps a listed file to a file card', () => {
    expect(driveListSources({ service: 'drive', entries: [file] })).toEqual([{
      kind: 'file',
      title: 'report.pdf',
      subtitle: '/Docs',
      date: '2026-10-01T09:00:00Z',
      link: '/drive?path=%2FDocs&item=%2FDocs%2Freport.pdf'
    }])
  })

  it('maps a folder to a folder card', () => {
    const sources = driveListSources({ service: 'drive', entries: [{ ...file, type: 'folder', mediaType: undefined }] })

    expect(sources[0]).toMatchObject({ kind: 'folder', title: 'report.pdf' })
  })

  it('maps a single file to one card and ignores an unknown output', () => {
    expect(driveInfoSources({ ...file, service: 'drive' })).toHaveLength(1)
    expect(driveInfoSources({})).toEqual([])
    expect(driveListSources(undefined)).toEqual([])
  })
})
