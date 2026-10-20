import { describe, expect, it, vi } from 'vitest'
import { removedLabelMessageIds } from '../server/utils/mail-sync'

describe('removedLabelMessageIds', () => {
  it('uses the Message-ID stored in SQL when the document is already gone', async () => {
    const documentsByLabel = vi.fn(async () => [])

    await expect(removedLabelMessageIds({
      stored: [{ uid: 300, messageId: '<a@example.com>' }],
      documents: [],
      documentsByLabel
    })).resolves.toEqual(['<a@example.com>'])

    expect(documentsByLabel).not.toHaveBeenCalled()
  })

  it('reads the Message-ID of a document that is still there', async () => {
    const documentsByLabel = vi.fn(async () => [])

    await expect(removedLabelMessageIds({
      stored: [{ uid: 300, messageId: null }],
      documents: [{ uid: 300, messageId: '<a@example.com>' }],
      documentsByLabel
    })).resolves.toEqual(['<a@example.com>'])

    expect(documentsByLabel).not.toHaveBeenCalled()
  })

  it('falls back to the documents still carrying the label when no row knows the message', async () => {
    const documentsByLabel = vi.fn(async () => [
      { messageId: '<a@example.com>' },
      { messageId: '<b@example.com>' }
    ])

    await expect(removedLabelMessageIds({
      stored: [{ uid: 300, messageId: null }],
      documents: [],
      documentsByLabel
    })).resolves.toEqual(['<a@example.com>', '<b@example.com>'])

    expect(documentsByLabel).toHaveBeenCalledOnce()
  })

  it('asks nothing without a stored row', async () => {
    const documentsByLabel = vi.fn(async () => [])

    await expect(removedLabelMessageIds({ stored: [], documents: [], documentsByLabel })).resolves.toEqual([])

    expect(documentsByLabel).not.toHaveBeenCalled()
  })
})
